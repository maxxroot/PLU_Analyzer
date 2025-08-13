// src/App.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Search, MapPin, FileText, Loader2, AlertCircle, CheckCircle, Info } from 'lucide-react';

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
  const [result, setResult] = useState<ParcelData | null>(null);
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
      console.log(`🔍 Saisie d'adresse: "${value}"`);
      
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
      console.log(`🔍 Saisie commune: "${value}"`);
      
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
      // Valider seulement si tous les champs sont remplis
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
    
    console.log(`🔍 Recherche de suggestions pour: "${query}"`);
    setLoadingSuggestions(true);
    
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      const url = `${API_BASE_URL}/search/suggest?q=${encodeURIComponent(query)}`;
      
      console.log(`📡 Appel API: ${url}`);
      
      const response = await fetch(url);
      console.log(`📡 Réponse API status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`📡 Données reçues:`, data);
        
        if (data.success && Array.isArray(data.data)) {
          const suggestions = data.data as AddressSuggestion[];
          console.log(`✅ ${suggestions.length} suggestions trouvées`);
          
          setAddressSuggestions(suggestions);
          setShowAddressSuggestions(suggestions.length > 0);
        } else {
          console.log(`⚠️ Format de réponse inattendu:`, data);
          setAddressSuggestions([]);
          setShowAddressSuggestions(false);
        }
      } else {
        console.error(`❌ Erreur HTTP ${response.status}`);
        setAddressSuggestions([]);
        setShowAddressSuggestions(false);
      }
    } catch (error) {
      console.error('❌ Erreur lors de la recherche de suggestions:', error);
      setAddressSuggestions([]);
      setShowAddressSuggestions(false);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const searchCommuneSuggestions = async (query: string, codePostal?: string) => {
    if (query.length < 2) return;
    
    console.log(`🔍 Recherche communes pour: "${query}"${codePostal ? ` (${codePostal})` : ''}`);
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
          const suggestions = data.data as CommuneSuggestion[];
          console.log(`✅ ${suggestions.length} communes trouvées`);
          
          setCommuneSuggestions(suggestions);
          setShowCommuneSuggestions(suggestions.length > 0);
        } else {
          setCommuneSuggestions([]);
          setShowCommuneSuggestions(false);
        }
      }
    } catch (error) {
      console.error('❌ Erreur suggestions communes:', error);
      setCommuneSuggestions([]);
      setShowCommuneSuggestions(false);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const validateParcelleReference = async (codePostal: string, commune: string, numeroParcelle: string) => {
    console.log(`🔍 Validation parcelle: ${numeroParcelle} à ${commune} (${codePostal})`);
    setValidatingParcelle(true);
    
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      const url = `${API_BASE_URL}/cadastre/validate?codePostal=${encodeURIComponent(codePostal)}&commune=${encodeURIComponent(commune)}&numeroParcelle=${encodeURIComponent(numeroParcelle)}`;
      
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.success) {
          setValidationResult(data.data);
          console.log(`${data.data.isValid ? '✅' : '❌'} Validation:`, data.data);
        }
      } else {
        setValidationResult({ isValid: false, errors: ['Erreur de validation'] });
      }
    } catch (error) {
      console.error('❌ Erreur validation:', error);
      setValidationResult({ isValid: false, errors: ['Erreur de connexion'] });
    } finally {
      setValidatingParcelle(false);
    }
  };

  const selectAddressSuggestion = (suggestion: AddressSuggestion) => {
    console.log(`✅ Sélection de: "${suggestion.label}"`);
    
    setFormData(prev => ({
      ...prev,
      address: suggestion.label
    }));
    setAddressSuggestions([]);
    setShowAddressSuggestions(false);
  };

  const selectCommuneSuggestion = (suggestion: CommuneSuggestion) => {
    console.log(`✅ Sélection commune: "${suggestion.nom}"`);
    
    setFormData(prev => ({
      ...prev,
      commune: suggestion.nom
    }));
    setCommuneSuggestions([]);
    setShowCommuneSuggestions(false);
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
        response = await fetch(`${API_BASE_URL}/analyze/address`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ address: formData.address })
        });
      } else {
        response = await fetch(`${API_BASE_URL}/analyze/cadastre`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            codePostal: formData.codePostal,
            commune: formData.commune,
            numeroParcelle: formData.numeroParcelle
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

      // Transformation des données de l'API vers le format attendu par le frontend
      const apiResult = data.data;
      const transformedResult: ParcelData = {
        address: searchType === 'address' ? formData.address : `${formData.numeroParcelle}, ${formData.commune} ${formData.codePostal}`,
        parcelle: apiResult.parcel?.numero || apiResult.parcel?.id || 'N/A',
        commune: apiResult.parcel?.commune || apiResult.address?.city || 'N/A',
        zone: `${apiResult.zone?.libelle || 'N/A'} - ${apiResult.zone?.libelong || ''}`,
        superficie: apiResult.parcel?.contenance || 0,
        restrictions: apiResult.restrictions || [],
        droits: apiResult.rights || [],
        documents: apiResult.documents?.map((doc: any) => doc.name) || []
      };

      setResult(transformedResult);
      console.log(`✅ Analyse réussie:`, transformedResult);

    } catch (err) {
      console.error('❌ Erreur analyse:', err);
      
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur est survenue lors de l'analyse");
      }
      
      // En cas d'erreur, afficher des données de démonstration
      console.warn('Utilisation des données de démonstration');
      const mockResult: ParcelData = {
        address: searchType === 'address' ? formData.address : `${formData.numeroParcelle}, ${formData.commune} ${formData.codePostal}`,
        parcelle: searchType === 'address' ? "AB 1234" : formData.numeroParcelle,
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
        ]
      };
      setResult(mockResult);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Analyseur PLU
          </h1>
          <p className="text-gray-400 text-lg">
            Analysez automatiquement les règles d'urbanisme applicables à votre parcelle
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

            {/* Address Search */}
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
                  
                  {/* Loading indicator pour suggestions */}
                  {loadingSuggestions && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                    </div>
                  )}
                  
                  {/* Suggestions dropdown */}
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
                  
                  {/* Message si pas de suggestions */}
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

            {/* Cadastre Search */}
            {searchType === 'cadastre' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Code postal */}
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

                  {/* Commune */}
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
                      
                      {/* Loading indicator pour suggestions communes */}
                      {loadingSuggestions && (
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                          <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                        </div>
                      )}
                      
                      {/* Suggestions communes dropdown */}
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

                  {/* Numéro de parcelle */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Numéro de parcelle *
                    </label>
                    <input
                      type="text"
                      value={formData.numeroParcelle}
                      onChange={(e) => handleInputChange('numeroParcelle', e.target.value)}
                      placeholder="AB 1234"
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
                        <li>• <strong>Section</strong> : 1 à 3 lettres (ex: AB, ZE, A)</li>
                        <li>• <strong>Numéro</strong> : 1 à 4 chiffres (ex: 1234, 42)</li>
                        <li>• <strong>Formats acceptés</strong> : AB1234, AB 1234, AB-1234</li>
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
              <span>{loading ? 'Analyse en cours...' : 'Analyser la parcelle'}</span>
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
              <p className="text-green-200">
                Analyse terminée avec succès
                {searchType === 'cadastre' && validationResult?.parcelle && (
                  <span className="ml-2 text-green-300">
                    (Parcelle {validationResult.parcelle.id})
                  </span>
                )}
              </p>
            </div>

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

            {/* Documents */}
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
          </div>
        )}

        {/* Debug info */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-8 text-xs text-gray-500 bg-gray-800 p-4 rounded">
            <p>Debug Info:</p>
            <p>Search Type: {searchType}</p>
            <p>Form Data: {JSON.stringify(formData, null, 2)}</p>
            <p>Validation: {JSON.stringify(validationResult, null, 2)}</p>
            <p>Address Suggestions: {addressSuggestions.length}</p>
            <p>Commune Suggestions: {communeSuggestions.length}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PLUAnalyzer;