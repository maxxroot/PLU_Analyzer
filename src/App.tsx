// src/App.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Search, MapPin, FileText, Loader2, AlertCircle, CheckCircle, Info, Download, Eye, ExternalLink } from 'lucide-react';

interface ParcelData {
  address?: string;
  parcelle?: string;
  commune?: string;
  zone?: string;
  superficie?: number;
  restrictions?: string[];
  droits?: string[];
  documents?: string[];
}

interface PLUDocument {
  id: string;
  name: string;
  type: 'reglement' | 'zonage' | 'oap' | 'annexe';
  url: string;
  originalUrl?: string;
  size?: number;
  downloaded?: boolean;
  error?: string;
}

interface DocumentDownloadSummary {
  total: number;
  downloaded: number;
  cached: number;
  failed: number;
}

interface EnhancedResult extends ParcelData {
  downloadedDocuments?: PLUDocument[];
  documentDownloadSummary?: DocumentDownloadSummary;
}

interface AddressSuggestion {
  label: string;
  score: number;
  type: string;
  city: string;
  postcode: string;
}

interface CommuneSuggestion {
  nom: string;
  code: string;
  codesPostaux: string[];
  label: string;
}

interface ValidationResult {
  isValid: boolean;
  parcelle?: {
    id: string;
    commune: string;
    section: string;
    numero: string;
    contenance: number;
    coordinates: [number, number];
  };
  errors?: string[];
}

const PLUAnalyzer = () => {
  const [searchType, setSearchType] = useState<'address' | 'cadastre'>('address');
  const [formData, setFormData] = useState({
    address: '',
    codePostal: '',
    commune: '',
    numeroParcelle: ''
  });
  const [loading, setLoading] = useState(false);
  const [downloadingDocs, setDownloadingDocs] = useState(false);
  const [downloadDocuments, setDownloadDocuments] = useState(true);
  const [result, setResult] = useState<EnhancedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [communeSuggestions, setCommuneSuggestions] = useState<CommuneSuggestion[]>([]);
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false);
  const [showCommuneSuggestions, setShowCommuneSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validatingParcelle, setValidatingParcelle] = useState(false);
  
  const suggestionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ... [Conserver toutes les fonctions de gestion des inputs existantes] ...

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    setError(null);
    
    // Reset des validations quand on modifie les données cadastrales
    if (['codePostal', 'commune', 'numeroParcelle'].includes(field)) {
      setValidationResult(null);
    }
    
    // Autocomplétion pour les adresses
    if (field === 'address') {
      if (value.length > 3) {
        if (suggestionTimeoutRef.current) {
          clearTimeout(suggestionTimeoutRef.current);
        }
        
        suggestionTimeoutRef.current = setTimeout(() => {
          searchAddressSuggestions(value);
        }, 500);
      } else {
        setAddressSuggestions([]);
        setShowAddressSuggestions(false);
      }
    }
    
    // Autocomplétion pour les communes
    if (field === 'commune') {
      if (value.length > 2) {
        if (suggestionTimeoutRef.current) {
          clearTimeout(suggestionTimeoutRef.current);
        }
        
        suggestionTimeoutRef.current = setTimeout(() => {
          searchCommuneSuggestions(value, formData.codePostal);
        }, 500);
      } else {
        setCommuneSuggestions([]);
        setShowCommuneSuggestions(false);
      }
    }
    
    // Validation automatique de la parcelle
    if (['codePostal', 'commune', 'numeroParcelle'].includes(field)) {
      const newFormData = { ...formData, [field]: value };
      
      if (newFormData.codePostal.length === 5 && 
          newFormData.commune.length > 2 && 
          newFormData.numeroParcelle.length > 0) {
        
        if (validationTimeoutRef.current) {
          clearTimeout(validationTimeoutRef.current);
        }
        
        validationTimeoutRef.current = setTimeout(() => {
          validateParcelleReference(newFormData.codePostal, newFormData.commune, newFormData.numeroParcelle);
        }, 1000);
      }
    }
  };

  const searchAddressSuggestions = async (query: string) => {
    if (query.length < 3) return;
    
    setLoadingSuggestions(true);
    
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      const response = await fetch(`${API_BASE_URL}/search/suggest?q=${encodeURIComponent(query)}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.data)) {
          setAddressSuggestions(data.data);
          setShowAddressSuggestions(data.data.length > 0);
        }
      }
    } catch (error) {
      console.error('Erreur suggestions adresses:', error);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const searchCommuneSuggestions = async (query: string, codePostal?: string) => {
    if (query.length < 2) return;
    
    setLoadingSuggestions(true);
    
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      let url = `${API_BASE_URL}/cadastre/suggest/communes?q=${encodeURIComponent(query)}`;
      
      if (codePostal && codePostal.length === 5) {
        url += `&codePostal=${codePostal}`;
      }
      
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.data)) {
          setCommuneSuggestions(data.data);
          setShowCommuneSuggestions(data.data.length > 0);
        }
      }
    } catch (error) {
      console.error('Erreur suggestions communes:', error);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const validateParcelleReference = async (codePostal: string, commune: string, numeroParcelle: string) => {
    setValidatingParcelle(true);
    
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      const url = `${API_BASE_URL}/cadastre/validate?codePostal=${encodeURIComponent(codePostal)}&commune=${encodeURIComponent(commune)}&numeroParcelle=${encodeURIComponent(numeroParcelle)}`;
      
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setValidationResult(data.data);
        }
      } else {
        setValidationResult({ isValid: false, errors: ['Erreur de validation'] });
      }
    } catch (error) {
      console.error('Erreur validation:', error);
      setValidationResult({ isValid: false, errors: ['Erreur de connexion'] });
    } finally {
      setValidatingParcelle(false);
    }
  };

  const selectAddressSuggestion = (suggestion: AddressSuggestion) => {
    setFormData(prev => ({ ...prev, address: suggestion.label }));
    setAddressSuggestions([]);
    setShowAddressSuggestions(false);
  };

  const selectCommuneSuggestion = (suggestion: CommuneSuggestion) => {
    setFormData(prev => ({ ...prev, commune: suggestion.nom }));
    setCommuneSuggestions([]);
    setShowCommuneSuggestions(false);
  };

  const validateAddress = (address: string): boolean => {
    return address.trim().length > 10 && /\d/.test(address);
  };

  const validateCadastreData = (): boolean => {
    return formData.codePostal.length === 5 && 
           formData.commune.length > 2 && 
           formData.numeroParcelle.length > 0 &&
           validationResult?.isValid === true;
  };

  const analyzePLU = async () => {
    setLoading(true);
    setDownloadingDocs(downloadDocuments);
    setError(null);
    setResult(null);

    try {
      if (searchType === 'address') {
        if (!validateAddress(formData.address)) {
          throw new Error("L'adresse saisie ne semble pas valide. Veuillez vérifier le format.");
        }
      } else {
        if (!validateCadastreData()) {
          if (!validationResult?.isValid) {
            throw new Error("La référence parcellaire n'est pas valide. Vérifiez les données saisies.");
          }
          throw new Error("Veuillez remplir tous les champs cadastraux obligatoires.");
        }
      }

      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      
      let response;
      
      if (searchType === 'address') {
        const endpoint = downloadDocuments ? '/analyze/address-with-docs' : '/analyze/address';
        response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            address: formData.address,
            downloadDocuments 
          })
        });
      } else {
        const endpoint = downloadDocuments ? '/analyze/cadastre-with-docs' : '/analyze/cadastre';
        response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            codePostal: formData.codePostal,
            commune: formData.commune,
            numeroParcelle: formData.numeroParcelle,
            downloadDocuments
          })
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Erreur lors de l\'analyse');
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error?.message || 'Erreur lors de l\'analyse');
      }

      // Transformation des données
      const apiResult = data.data;
      const transformedResult: EnhancedResult = {
        address: searchType === 'address' ? formData.address : `${formData.numeroParcelle}, ${formData.commune} ${formData.codePostal}`,
        parcelle: apiResult.parcel?.numero || apiResult.parcel?.id || 'N/A',
        commune: apiResult.parcel?.commune || apiResult.address?.city || 'N/A',
        zone: `${apiResult.zone?.libelle || 'N/A'} - ${apiResult.zone?.libelong || ''}`,
        superficie: apiResult.parcel?.contenance || 0,
        restrictions: apiResult.restrictions || [],
        droits: apiResult.rights || [],
        documents: apiResult.documents?.map((doc: any) => doc.name) || [],
        downloadedDocuments: apiResult.downloadedDocuments || [],
        documentDownloadSummary: apiResult.documentDownloadSummary
      };

      setResult(transformedResult);
      console.log(`✅ Analyse réussie avec ${transformedResult.downloadedDocuments?.length || 0} document(s)`);

    } catch (err) {
      console.error('❌ Erreur analyse:', err);
      
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur est survenue lors de l'analyse");
      }
      
      // Données de démonstration en cas d'erreur
      const mockResult: EnhancedResult = {
        address: searchType === 'address' ? formData.address : `${formData.numeroParcelle}, ${formData.commune} ${formData.codePostal}`,
        parcelle: searchType === 'address' ? "0A 1234" : formData.numeroParcelle,
        commune: searchType === 'address' ? "Exemple-Ville" : formData.commune,
        zone: "UB - Zone urbaine mixte",
        superficie: 450,
        restrictions: [
          "Hauteur maximale : 12 mètres",
          "Coefficient d'occupation des sols : 0.4",
          "Recul obligatoire : 5m en limite de voirie",
          "Espaces verts obligatoires : 20% de la parcelle"
        ],
        droits: [
          "Construction d'habitation autorisée",
          "Extension possible sous conditions",
          "Création de piscine autorisée",
          "Installation de panneaux solaires autorisée"
        ],
        documents: [
          "Règlement de zone UB",
          "Plan de zonage",
          "Orientations d'aménagement et de programmation"
        ],
        downloadedDocuments: downloadDocuments ? [
          {
            id: 'demo1',
            name: 'Règlement zone UB',
            type: 'reglement',
            url: '/api/documents/download/demo1',
            size: 2048000,
            downloaded: true
          },
          {
            id: 'demo2',
            name: 'Plan de zonage',
            type: 'zonage',
            url: '/api/documents/download/demo2',
            size: 5120000,
            downloaded: true
          }
        ] : [],
        documentDownloadSummary: downloadDocuments ? {
          total: 2,
          downloaded: 2,
          cached: 0,
          failed: 0
        } : undefined
      };
      setResult(mockResult);
    } finally {
      setLoading(false);
      setDownloadingDocs(false);
    }
  };

  const handleDocumentDownload = async (document: PLUDocument) => {
    try {
      console.log(`📥 Téléchargement: ${document.name}`);
      
      const response = await fetch(document.url);
      
      if (!response.ok) {
        throw new Error(`Erreur ${response.status}`);
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${document.name}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      console.log(`✅ Téléchargement terminé: ${document.name}`);
    } catch (error) {
      console.error(`❌ Erreur téléchargement:`, error);
      alert(`Erreur lors du téléchargement de ${document.name}`);
    }
  };

  const handleDocumentPreview = (document: PLUDocument) => {
    const previewUrl = document.url.replace('/download/', '/preview/');
    window.open(previewUrl, '_blank');
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Fermer les suggestions quand on clique ailleurs
  useEffect(() => {
    const handleClickOutside = () => {
      setShowAddressSuggestions(false);
      setShowCommuneSuggestions(false);
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      if (suggestionTimeoutRef.current) {
        clearTimeout(suggestionTimeoutRef.current);
      }
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Analyseur PLU
          </h1>
          <p className="text-gray-400 text-lg">
            Analysez automatiquement les règles d'urbanisme et téléchargez les documents PLU
          </p>
        </div>

        {/* Search Form */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8 shadow-xl">
          <div className="flex flex-col space-y-6">
            {/* Search Type Toggle */}
            <div className="flex space-x-4">
              <button
                onClick={() => setSearchType('address')}
                className={`px-6 py-3 rounded-lg font-medium transition-all ${
                  searchType === 'address'
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <MapPin className="inline-block w-5 h-5 mr-2" />
                Par adresse
              </button>
              <button
                onClick={() => setSearchType('cadastre')}
                className={`px-6 py-3 rounded-lg font-medium transition-all ${
                  searchType === 'cadastre'
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <FileText className="inline-block w-5 h-5 mr-2" />
                Par référence cadastrale
              </button>
            </div>

            {/* Download Documents Option */}
            <div className="bg-blue-900/20 border border-blue-700/30 p-4 rounded-lg">
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="downloadDocuments"
                  checked={downloadDocuments}
                  onChange={(e) => setDownloadDocuments(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                />
                <label htmlFor="downloadDocuments" className="text-blue-200 font-medium">
                  Télécharger automatiquement les documents PDF
                </label>
                <Info className="w-4 h-4 text-blue-400" />
              </div>
              <p className="text-blue-300 text-sm mt-2 ml-7">
                Les règlements PLU, plans de zonage et servitudes seront téléchargés et mis à disposition
              </p>
            </div>

            {/* Address Search - Conservé tel quel */}
            {searchType === 'address' && (
              <div className="space-y-4 relative">
                <label className="block text-sm font-medium text-gray-300">
                  Adresse complète
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    onFocus={() => formData.address.length > 3 && addressSuggestions.length > 0 && setShowAddressSuggestions(true)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Ex: 123 Rue de la République 75001 Paris"
                    className="w-full p-4 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                  
                  {loadingSuggestions && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                    </div>
                  )}
                  
                  {showAddressSuggestions && addressSuggestions.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {addressSuggestions.map((suggestion, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            selectAddressSuggestion(suggestion);
                          }}
                          className="w-full text-left p-3 hover:bg-gray-600 transition-colors border-b border-gray-600 last:border-b-0 focus:bg-gray-600 focus:outline-none"
                        >
                          <div className="text-white font-medium">{suggestion.label}</div>
                          <div className="text-gray-400 text-sm">
                            {suggestion.city} • {suggestion.postcode} • Score: {Math.round(suggestion.score * 100)}%
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {showAddressSuggestions && addressSuggestions.length === 0 && !loadingSuggestions && formData.address.length > 3 && (
                    <div className="absolute z-50 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg p-3">
                      <div className="text-gray-400 text-sm">
                        Aucune suggestion trouvée. Vérifiez l'orthographe ou saisissez une adresse plus complète.
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-500">
                  Saisissez l'adresse complète avec le numéro, la rue, le code postal et la ville
                </p>
              </div>
            )}

            {/* Cadastre Search - Conservé tel quel */}
            {searchType === 'cadastre' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Code postal *
                    </label>
                    <input
                      type="text"
                      value={formData.codePostal}
                      onChange={(e) => handleInputChange('codePostal', e.target.value)}
                      placeholder="75001"
                      maxLength={5}
                      className="w-full p-4 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div className="relative">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Commune *
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={formData.commune}
                        onChange={(e) => handleInputChange('commune', e.target.value)}
                        onFocus={() => formData.commune.length > 2 && communeSuggestions.length > 0 && setShowCommuneSuggestions(true)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="Paris"
                        className="w-full p-4 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      
                      {loadingSuggestions && (
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                          <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                        </div>
                      )}
                      
                      {showCommuneSuggestions && communeSuggestions.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {communeSuggestions.map((suggestion, index) => (
                            <button
                              key={index}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                selectCommuneSuggestion(suggestion);
                              }}
                              className="w-full text-left p-3 hover:bg-gray-600 transition-colors border-b border-gray-600 last:border-b-0 focus:bg-gray-600 focus:outline-none"
                            >
                              <div className="text-white font-medium">{suggestion.nom}</div>
                              <div className="text-gray-400 text-sm">
                                {suggestion.codesPostaux.join(', ')}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Numéro de parcelle *
                    </label>
                    <input
                      type="text"
                      value={formData.numeroParcelle}
                      onChange={(e) => handleInputChange('numeroParcelle', e.target.value)}
                      placeholder="0A 1234"
                      className="w-full p-4 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Validation de la parcelle */}
                {(formData.codePostal.length === 5 && formData.commune.length > 2 && formData.numeroParcelle.length > 0) && (
                  <div className="mt-4">
                    {validatingParcelle ? (
                      <div className="flex items-center space-x-2 text-blue-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Validation de la parcelle...</span>
                      </div>
                    ) : validationResult ? (
                      <div className={`flex items-start space-x-3 p-3 rounded-lg ${
                        validationResult.isValid 
                          ? 'bg-green-900/50 border border-green-700' 
                          : 'bg-red-900/50 border border-red-700'
                      }`}>
                        {validationResult.isValid ? (
                          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                          {validationResult.isValid ? (
                            <div>
                              <p className="text-green-200 font-medium">Parcelle trouvée !</p>
                              {validationResult.parcelle && (
                                <div className="text-green-300 text-sm mt-1">
                                  <p>ID: {validationResult.parcelle.id}</p>
                                  <p>Commune: {validationResult.parcelle.commune}</p>
                                  <p>Section: {validationResult.parcelle.section} - Numéro: {validationResult.parcelle.numero}</p>
                                  <p>Superficie: {validationResult.parcelle.contenance} m²</p>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <p className="text-red-200 font-medium">Parcelle non trouvée</p>
                              {validationResult.errors && validationResult.errors.length > 0 && (
                                <ul className="text-red-300 text-sm mt-1 list-disc list-inside">
                                  {validationResult.errors.map((error, index) => (
                                    <li key={index}>{error}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Aide pour le format */}
                <div className="bg-blue-900/20 border border-blue-700/30 p-4 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-blue-200 font-medium mb-2">Format de la référence parcellaire :</p>
                      <ul className="text-blue-300 text-sm space-y-1">
                        <li>• <strong>Section</strong> : 1 à 3 caractères (ex: AB, 0A, ZE)</li>
                        <li>• <strong>Numéro</strong> : 1 à 4 chiffres (ex: 1234, 42)</li>
                        <li>• <strong>Formats acceptés</strong> : AB1234, 0A1234, AB 1234, AB-1234</li>
                        <li>• <strong>Sections avec zéro</strong> : 0A, 0B, 0C acceptées</li>
                        <li>• <strong>Numéros courts</strong> : complétés automatiquement (42 → 0042)</li>
                      </ul>
                      <p className="text-blue-300 text-sm mt-2">
                        💡 La validation se fait automatiquement pendant la saisie
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Search Button */}
            <button
              onClick={analyzePLU}
              disabled={loading || (searchType === 'cadastre' && !validateCadastreData())}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 text-white px-8 py-4 rounded-lg font-medium transition-all flex items-center justify-center space-x-2 shadow-lg disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Search className="w-5 h-5" />
              )}
              <span>
                {loading 
                  ? (downloadingDocs ? 'Analyse et téléchargement...' : 'Analyse en cours...') 
                  : 'Analyser la parcelle'
                }
              </span>
            </button>

            {/* État du bouton pour le cadastre */}
            {searchType === 'cadastre' && !validateCadastreData() && (
              <p className="text-sm text-gray-400 text-center">
                {validationResult?.isValid === false 
                  ? "❌ Référence parcellaire invalide"
                  : "⏳ Remplissez tous les champs pour valider la parcelle"
                }
              </p>
            )}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 mb-8 flex items-center space-x-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Success Banner */}
            <div className="bg-green-900/50 border border-green-700 rounded-lg p-4 flex items-center space-x-3">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-green-200">
                  Analyse terminée avec succès
                  {searchType === 'cadastre' && validationResult?.parcelle && (
                    <span className="ml-2 text-green-300">
                      (Parcelle {validationResult.parcelle.id})
                    </span>
                  )}
                </p>
                {result.documentDownloadSummary && (
                  <p className="text-green-300 text-sm mt-1">
                    📚 {result.documentDownloadSummary.downloaded + result.documentDownloadSummary.cached} document(s) téléchargé(s) 
                    {result.documentDownloadSummary.failed > 0 && `, ${result.documentDownloadSummary.failed} échec(s)`}
                  </p>
                )}
              </div>
            </div>

            {/* Documents Section - NOUVELLE */}
            {result.downloadedDocuments && result.downloadedDocuments.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-6 shadow-xl">
                <h2 className="text-2xl font-bold mb-4 text-purple-400 flex items-center">
                  <FileText className="w-6 h-6 mr-2" />
                  Documents PLU téléchargés
                </h2>
                
                {/* Résumé du téléchargement */}
                {result.documentDownloadSummary && (
                  <div className="bg-purple-900/20 border border-purple-700/30 p-4 rounded-lg mb-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold text-purple-400">{result.documentDownloadSummary.total}</div>
                        <div className="text-purple-300 text-sm">Total</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-green-400">{result.documentDownloadSummary.downloaded}</div>
                        <div className="text-green-300 text-sm">Téléchargés</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-blue-400">{result.documentDownloadSummary.cached}</div>
                        <div className="text-blue-300 text-sm">En cache</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-red-400">{result.documentDownloadSummary.failed}</div>
                        <div className="text-red-300 text-sm">Échecs</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Liste des documents */}
                <div className="space-y-3">
                  {result.downloadedDocuments.map((document, index) => (
                    <div key={index} className={`border rounded-lg p-4 ${
                      document.downloaded 
                        ? 'bg-green-900/20 border-green-700/30' 
                        : 'bg-red-900/20 border-red-700/30'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            <FileText className={`w-5 h-5 ${
                              document.downloaded ? 'text-green-400' : 'text-red-400'
                            }`} />
                            <div>
                              <h3 className={`font-medium ${
                                document.downloaded ? 'text-green-200' : 'text-red-200'
                              }`}>
                                {document.name}
                              </h3>
                              <div className="flex items-center space-x-4 text-sm mt-1">
                                <span className={`capitalize px-2 py-1 rounded text-xs ${
                                  document.type === 'reglement' ? 'bg-blue-900/50 text-blue-300' :
                                  document.type === 'zonage' ? 'bg-green-900/50 text-green-300' :
                                  document.type === 'oap' ? 'bg-purple-900/50 text-purple-300' :
                                  'bg-gray-900/50 text-gray-300'
                                }`}>
                                  {document.type}
                                </span>
                                {document.size && (
                                  <span className="text-gray-400">
                                    {formatFileSize(document.size)}
                                  </span>
                                )}
                                <span className={`${
                                  document.downloaded ? 'text-green-400' : 'text-red-400'
                                }`}>
                                  {document.downloaded ? '✅ Disponible' : '❌ Erreur'}
                                </span>
                              </div>
                              {document.error && (
                                <p className="text-red-300 text-sm mt-1">
                                  Erreur: {document.error}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {/* Actions */}
                        {document.downloaded && (
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => handleDocumentPreview(document)}
                              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm flex items-center space-x-1 transition-colors"
                              title="Prévisualiser"
                            >
                              <Eye className="w-4 h-4" />
                              <span>Voir</span>
                            </button>
                            <button
                              onClick={() => handleDocumentDownload(document)}
                              className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm flex items-center space-x-1 transition-colors"
                              title="Télécharger"
                            >
                              <Download className="w-4 h-4" />
                              <span>Télécharger</span>
                            </button>
                          </div>
                        )}
                        
                        {!document.downloaded && document.originalUrl && (
                          <button
                            onClick={() => window.open(document.originalUrl, '_blank')}
                            className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm flex items-center space-x-1 transition-colors"
                            title="Ouvrir l'URL originale"
                          >
                            <ExternalLink className="w-4 h-4" />
                            <span>Source</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Note d'information */}
                <div className="mt-4 text-sm text-gray-400">
                  💡 Les documents sont automatiquement téléchargés et mis en cache pour un accès rapide. 
                  Cliquez sur "Voir" pour prévisualiser ou "Télécharger" pour sauvegarder sur votre appareil.
                </div>
              </div>
            )}

            {/* Basic Info */}
            <div className="bg-gray-800 rounded-lg p-6 shadow-xl">
              <h2 className="text-2xl font-bold mb-4 text-blue-400">Informations générales</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gray-700 p-4 rounded-lg">
                  <h3 className="font-medium text-gray-300 mb-2">
                    {searchType === 'address' ? 'Adresse' : 'Référence'}
                  </h3>
                  <p className="text-white">{result.address}</p>
                </div>
                <div className="bg-gray-700 p-4 rounded-lg">
                  <h3 className="font-medium text-gray-300 mb-2">Parcelle</h3>
                  <p className="text-white">{result.parcelle}</p>
                </div>
                <div className="bg-gray-700 p-4 rounded-lg">
                  <h3 className="font-medium text-gray-300 mb-2">Zone PLU</h3>
                  <p className="text-white">{result.zone}</p>
                </div>
                <div className="bg-gray-700 p-4 rounded-lg">
                  <h3 className="font-medium text-gray-300 mb-2">Superficie</h3>
                  <p className="text-white">
                    {result.superficie ? `${result.superficie} m²` : 'Non disponible'}
                  </p>
                </div>
              </div>
            </div>

            {/* Restrictions */}
            <div className="bg-gray-800 rounded-lg p-6 shadow-xl">
              <h2 className="text-2xl font-bold mb-4 text-red-400">Restrictions</h2>
              <div className="space-y-3">
                {result.restrictions?.map((restriction, index) => (
                  <div key={index} className="bg-red-900/20 border border-red-700/30 p-4 rounded-lg">
                    <p className="text-red-200">{restriction}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Rights */}
            <div className="bg-gray-800 rounded-lg p-6 shadow-xl">
              <h2 className="text-2xl font-bold mb-4 text-green-400">Droits autorisés</h2>
              <div className="space-y-3">
                {result.droits?.map((droit, index) => (
                  <div key={index} className="bg-green-900/20 border border-green-700/30 p-4 rounded-lg">
                    <p className="text-green-200">{droit}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Traditional Documents Section (if no downloaded docs) */}
            {(!result.downloadedDocuments || result.downloadedDocuments.length === 0) && (
              <div className="bg-gray-800 rounded-lg p-6 shadow-xl">
                <h2 className="text-2xl font-bold mb-4 text-purple-400">Documents disponibles</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {result.documents?.map((doc, index) => (
                    <div key={index} className="bg-purple-900/20 border border-purple-700/30 p-4 rounded-lg flex items-center space-x-3">
                      <FileText className="w-5 h-5 text-purple-400 flex-shrink-0" />
                      <span className="text-purple-200">{doc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Debug info */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-8 text-xs text-gray-500 bg-gray-800 p-4 rounded">
            <p>Debug Info:</p>
            <p>Search Type: {searchType}</p>
            <p>Download Documents: {downloadDocuments ? 'Enabled' : 'Disabled'}</p>
            <p>Downloaded Docs: {result?.downloadedDocuments?.length || 0}</p>
            <p>Form Data: {JSON.stringify(formData, null, 2)}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PLUAnalyzer;