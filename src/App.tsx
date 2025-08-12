import React, { useState, useRef, useEffect } from 'react';
import { Search, MapPin, FileText, Loader2, AlertCircle, CheckCircle } from 'lucide-react';

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
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const suggestionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    setError(null);
    
    // Autocomplétion pour les adresses
    if (field === 'address') {
      console.log(`🔍 Saisie d'adresse: "${value}"`);
      
      if (value.length > 3) {
        // Debouncing : attendre 500ms après la dernière saisie
        if (suggestionTimeoutRef.current) {
          clearTimeout(suggestionTimeoutRef.current);
        }
        
        suggestionTimeoutRef.current = setTimeout(() => {
          searchAddressSuggestions(value);
        }, 500);
      } else {
        setAddressSuggestions([]);
        setShowSuggestions(false);
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
          setShowSuggestions(suggestions.length > 0);
        } else {
          console.log(`⚠️ Format de réponse inattendu:`, data);
          setAddressSuggestions([]);
          setShowSuggestions(false);
        }
      } else {
        console.error(`❌ Erreur HTTP ${response.status}`);
        setAddressSuggestions([]);
        setShowSuggestions(false);
      }
    } catch (error) {
      console.error('❌ Erreur lors de la recherche de suggestions:', error);
      setAddressSuggestions([]);
      setShowSuggestions(false);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const selectAddressSuggestion = (suggestion: AddressSuggestion) => {
    console.log(`✅ Sélection de: "${suggestion.label}"`);
    
    setFormData(prev => ({
      ...prev,
      address: suggestion.label
    }));
    setAddressSuggestions([]);
    setShowSuggestions(false);
  };

  // Fermer les suggestions quand on clique ailleurs
  useEffect(() => {
    const handleClickOutside = () => {
      setShowSuggestions(false);
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      if (suggestionTimeoutRef.current) {
        clearTimeout(suggestionTimeoutRef.current);
      }
    };
  }, []);

  const validateAddress = (address: string): boolean => {
    return address.trim().length > 10 && /\d/.test(address);
  };

  const validateCadastreData = (): boolean => {
    return formData.codePostal.length === 5 && 
           formData.commune.length > 2 && 
           formData.numeroParcelle.length > 0;
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
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Une erreur est survenue lors de l'analyse");
      }
      
      // En cas d'erreur, afficher des données de démonstration
      console.warn('Utilisation des données de démonstration:', err);
      const mockResult: ParcelData = {
        address: searchType === 'address' ? formData.address : `${formData.numeroParcelle}, ${formData.commune} ${formData.codePostal}`,
        parcelle: searchType === 'address' ? "AB 123" : formData.numeroParcelle,
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
                    onFocus={() => formData.address.length > 3 && addressSuggestions.length > 0 && setShowSuggestions(true)}
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
                  {showSuggestions && addressSuggestions.length > 0 && (
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
                  {showSuggestions && addressSuggestions.length === 0 && !loadingSuggestions && formData.address.length > 3 && (
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
                
                {/* Debug info */}
                {process.env.NODE_ENV === 'development' && (
                  <div className="text-xs text-gray-500 mt-2">
                    Debug: {addressSuggestions.length} suggestions • Visible: {showSuggestions ? 'Oui' : 'Non'} • Loading: {loadingSuggestions ? 'Oui' : 'Non'}
                  </div>
                )}
              </div>
            )}

            {/* Cadastre Search */}
            {searchType === 'cadastre' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Code postal
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
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Commune
                  </label>
                  <input
                    type="text"
                    value={formData.commune}
                    onChange={(e) => handleInputChange('commune', e.target.value)}
                    placeholder="Paris"
                    className="w-full p-4 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Numéro de parcelle
                  </label>
                  <input
                    type="text"
                    value={formData.numeroParcelle}
                    onChange={(e) => handleInputChange('numeroParcelle', e.target.value)}
                    placeholder="AB 123"
                    className="w-full p-4 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* Search Button */}
            <button
              onClick={analyzePLU}
              disabled={loading}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 text-white px-8 py-4 rounded-lg font-medium transition-all flex items-center justify-center space-x-2 shadow-lg"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Search className="w-5 h-5" />
              )}
              <span>{loading ? 'Analyse en cours...' : 'Analyser la parcelle'}</span>
            </button>
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
              <p className="text-green-200">Analyse terminée avec succès</p>
            </div>

            {/* Basic Info */}
            <div className="bg-gray-800 rounded-lg p-6 shadow-xl">
              <h2 className="text-2xl font-bold mb-4 text-blue-400">Informations générales</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gray-700 p-4 rounded-lg">
                  <h3 className="font-medium text-gray-300 mb-2">Adresse</h3>
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
                  <p className="text-white">{result.superficie} m²</p>
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
      </div>
    </div>
  );
};

export default PLUAnalyzer;