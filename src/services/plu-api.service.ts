// src/services/plu-api.service.ts
import { 
  AddressData, 
  ParcelData, 
  ZoneUrbaData, 
  SupData, 
  PLUAnalysisResult 
} from '../types/plu.types';

import { 
  CadastreSearchService, 
  CadastreSearchParams,
  ParcelleResult 
} from './cadastre-search.service';

// Import conditionnel du service d'extraction PDF
let pluExtractorService: any = null;
try {
  const extractorModule = require('./pdf-extractor/plu-extractor.service');
  pluExtractorService = extractorModule.pluExtractorService;
} catch (error) {
  console.warn('Service d\'extraction PDF non disponible:', error);
}

export class PLUApiService {
  private readonly BAN_URL = "https://api-adresse.data.gouv.fr/search/";
  private readonly CADASTRE_PARCEL_URL = "https://apicarto.ign.fr/api/cadastre/parcelle";
  private readonly GPU_ZONE_URL = "https://apicarto.ign.fr/api/gpu/zone-urba";
  private readonly GPU_SUP_S = "https://apicarto.ign.fr/api/gpu/assiette-sup-s";
  private readonly GPU_SUP_L = "https://apicarto.ign.fr/api/gpu/assiette-sup-l";
  private readonly GPU_SUP_P = "https://apicarto.ign.fr/api/gpu/assiette-sup-p";

  private cadastreService: CadastreSearchService;

  constructor() {
    this.cadastreService = new CadastreSearchService();
  }

  /**
   * NOUVELLE MÉTHODE CORRIGÉE: Analyse par référence cadastrale
   */
  async analyzeByCadastre(codePostal: string, commune: string, numeroParcelle: string): Promise<PLUAnalysisResult> {
    console.log(`🗺️ Analyse par cadastre: ${numeroParcelle} à ${commune} (${codePostal})`);
    
    try {
      // 1. Valider les paramètres
      const params: CadastreSearchParams = { codePostal, commune, numeroParcelle };
      const validationErrors = this.cadastreService.validateSearchParams(params);
      
      if (validationErrors.length > 0) {
        throw new Error(`Paramètres invalides: ${validationErrors.join(', ')}`);
      }

      // 2. Rechercher la parcelle cadastrale
      const parcelleResult = await this.cadastreService.searchParcelle(params);
      
      if (!parcelleResult) {
        throw new Error(`Parcelle "${numeroParcelle}" non trouvée dans la commune ${commune} (${codePostal})`);
      }

      // 3. Utiliser les coordonnées de la parcelle pour l'analyse PLU
      const [longitude, latitude] = parcelleResult.centroid;
      
      console.log(`📍 Coordonnées parcelle: ${longitude}, ${latitude}`);

      // 4. Récupérer les données d'urbanisme
      const zoneData = await this.getUrbanZoneData(longitude, latitude);
      const servitudes = await this.getServitudes(longitude, latitude);

      // 5. Créer des données d'adresse synthétiques
      const syntheticAddress: AddressData = {
        label: `Parcelle ${numeroParcelle}, ${commune} ${codePostal}`,
        score: 0.95, // Score élevé car recherche directe
        postcode: codePostal,
        city: commune,
        context: `${parcelleResult.commune}, ${this.getDepartmentFromCode(codePostal)}`,
        type: 'parcel',
        importance: 0.8,
        x: longitude,
        y: latitude
      };

      // 6. Formater les données de parcelle
      const parcelData: ParcelData = {
        id: parcelleResult.id,
        commune: parcelleResult.commune,
        prefixe: parcelleResult.prefixe,
        section: parcelleResult.section,
        numero: parcelleResult.numero,
        contenance: parcelleResult.contenance,
        geometry: parcelleResult.geometry
      };

      // 7. Analyser le règlement
      const analysis = this.analyzeReglement(zoneData);

      // 8. Compilation des documents
      const documents = [
        {
          name: `Règlement de zone ${zoneData.libelle}`,
          url: zoneData.urlfic || '',
          type: 'reglement' as const
        },
        {
          name: 'Plan de zonage',
          url: '',
          type: 'zonage' as const
        },
        {
          name: `Fiche parcellaire ${parcelleResult.id}`,
          url: `https://www.cadastre.gouv.fr/scpc/rechparcel.do?file=${parcelleResult.id}`,
          type: 'reglement' as const
        }
      ];

      console.log(`✅ Analyse cadastrale terminée pour: ${parcelleResult.id}`);

      return {
        address: syntheticAddress,
        parcel: parcelData,
        zone: zoneData,
        servitudes,
        restrictions: analysis.restrictions,
        rights: analysis.rights,
        documents
      };

    } catch (error) {
      console.error(`❌ Erreur lors de l'analyse cadastrale:`, error);
      
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Erreur lors de l\'analyse par référence cadastrale');
    }
  }

  /**
   * NOUVELLE MÉTHODE: Suggestions de communes pour l'autocomplétion
   */
  async suggestCommunes(query: string, codePostal?: string): Promise<Array<{
    nom: string;
    code: string;
    codesPostaux: string[];
    label: string;
  }>> {
    try {
      const suggestions = await this.cadastreService.suggestCommunes(query, codePostal);
      
      return suggestions.map(commune => ({
        nom: commune.nom,
        code: commune.code,
        codesPostaux: commune.codesPostaux,
        label: `${commune.nom} (${commune.codesPostaux.join(', ')})`
      }));
    } catch (error) {
      console.warn('⚠️ Erreur suggestions communes:', error);
      return [];
    }
  }

  /**
   * NOUVELLE MÉTHODE: Validation d'une référence parcellaire
   */
  async validateParcelReference(codePostal: string, commune: string, numeroParcelle: string): Promise<{
    isValid: boolean;
    parcelle?: ParcelleResult;
    errors?: string[];
  }> {
    try {
      const params: CadastreSearchParams = { codePostal, commune, numeroParcelle };
      const validationErrors = this.cadastreService.validateSearchParams(params);
      
      if (validationErrors.length > 0) {
        return {
          isValid: false,
          errors: validationErrors
        };
      }

      const parcelle = await this.cadastreService.searchParcelle(params);
      
      return {
        isValid: !!parcelle,
        parcelle: parcelle || undefined,
        errors: parcelle ? [] : [`Parcelle "${numeroParcelle}" non trouvée`]
      };

    } catch (error) {
      return {
        isValid: false,
        errors: [error instanceof Error ? error.message : 'Erreur de validation']
      };
    }
  }

  /**
   * Méthode utilitaire pour obtenir le département depuis le code postal
   */
  private getDepartmentFromCode(codePostal: string): string {
    const departmentCode = codePostal.substring(0, 2);
    
    const departments: { [key: string]: string } = {
      '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence',
      '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes',
      '09': 'Ariège', '10': 'Aube', '11': 'Aude', '12': 'Aveyron',
      '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente',
      '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '20': 'Corse',
      '21': 'Côte-d\'Or', '22': 'Côtes-d\'Armor', '23': 'Creuse', '24': 'Dordogne',
      '25': 'Doubs', '26': 'Drôme', '27': 'Eure', '28': 'Eure-et-Loir',
      '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne', '32': 'Gers',
      '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine', '36': 'Indre',
      '37': 'Indre-et-Loire', '38': 'Isère', '39': 'Jura', '40': 'Landes',
      '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire', '44': 'Loire-Atlantique',
      '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne', '48': 'Lozère',
      '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne', '52': 'Haute-Marne',
      '53': 'Mayenne', '54': 'Meurthe-et-Moselle', '55': 'Meuse', '56': 'Morbihan',
      '57': 'Moselle', '58': 'Nièvre', '59': 'Nord', '60': 'Oise',
      '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme', '64': 'Pyrénées-Atlantiques',
      '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin', '68': 'Haut-Rhin',
      '69': 'Rhône', '70': 'Haute-Saône', '71': 'Saône-et-Loire', '72': 'Sarthe',
      '73': 'Savoie', '74': 'Haute-Savoie', '75': 'Paris', '76': 'Seine-Maritime',
      '77': 'Seine-et-Marne', '78': 'Yvelines', '79': 'Deux-Sèvres', '80': 'Somme',
      '81': 'Tarn', '82': 'Tarn-et-Garonne', '83': 'Var', '84': 'Vaucluse',
      '85': 'Vendée', '86': 'Vienne', '87': 'Haute-Vienne', '88': 'Vosges',
      '89': 'Yonne', '90': 'Territoire de Belfort', '91': 'Essonne', '92': 'Hauts-de-Seine',
      '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne', '95': 'Val-d\'Oise'
    };
    
    return departments[departmentCode] || `Département ${departmentCode}`;
  }

  // ... [Conserver toutes les autres méthodes existantes] ...

  /**
   * MÉTHODE MISE À JOUR: Analyse enrichie avec extraction PDF automatique
   */
  async analyzeByAddressWithPDFExtraction(address: string, options: {
    extractFromPDF?: boolean;
    useAI?: boolean;
    forceRefresh?: boolean;
  } = {}): Promise<PLUAnalysisResult & { pdfAnalysis?: any }> {
    console.log(`🚀 Analyse enrichie pour: ${address}`);
    
    try {
      // 1. Analyse standard existante
      const standardAnalysis = await this.analyzeByAddress(address);
      
      // 2. Tentative d'extraction PDF si disponible et demandée
      let pdfAnalysis: any;
      
      if (options.extractFromPDF !== false && standardAnalysis.zone.urlfic && pluExtractorService) {
        try {
          console.log(`📄 Extraction PDF depuis: ${standardAnalysis.zone.urlfic}`);
          
          pdfAnalysis = await pluExtractorService.extractFromPDF(
            standardAnalysis.zone.urlfic,
            this.extractZoneCode(standardAnalysis.zone.libelle),
            {
              useAI: options.useAI,
              forceRefresh: options.forceRefresh
            }
          );

          // 3. Enrichissement avec les données PDF
          if (pdfAnalysis && pdfAnalysis.confidence > 0.5) {
            standardAnalysis.restrictions = this.mergeRestrictions(
              standardAnalysis.restrictions,
              pdfAnalysis.restrictions
            );
            
            standardAnalysis.rights = this.mergeRights(
              standardAnalysis.rights,
              pdfAnalysis.rights
            );
            
            // Ajouter les documents PDF
            standardAnalysis.documents.push({
              name: `Analyse détaillée zone ${pdfAnalysis.zone}`,
              url: standardAnalysis.zone.urlfic,
              type: 'reglement'
            });
          }
          
          console.log(`✅ Extraction PDF réussie: ${Math.round(pdfAnalysis.confidence * 100)}% confiance`);
          
        } catch (pdfError) {
          console.warn(`⚠️ Extraction PDF échouée:`, pdfError);
          // Continue avec l'analyse standard seulement
        }
      } else if (options.extractFromPDF !== false && !pluExtractorService) {
        console.warn('⚠️ Service d\'extraction PDF non disponible');
      }

      return {
        ...standardAnalysis,
        pdfAnalysis
      };

    } catch (error) {
      console.error(`❌ Erreur analyse enrichie:`, error);
      throw error;
    }
  }

  /**
   * Extrait le code de zone depuis le libellé
   */
  private extractZoneCode(libelle: string): string {
    // Extraire le code de zone (ex: "UB" de "UB - Zone urbaine mixte")
    const match = libelle.match(/^([A-Z]{1,3}\d*[A-Z]*)/);
    return match ? match[1] : libelle.substring(0, 3);
  }

  /**
   * Fusionne les restrictions en évitant les doublons
   */
  private mergeRestrictions(standard: string[], pdf: string[]): string[] {
    const merged = [...standard];
    
    for (const pdfRestriction of pdf) {
      // Vérifier si une restriction similaire existe déjà
      const exists = merged.some(existing => 
        this.areSimilarStrings(existing, pdfRestriction)
      );
      
      if (!exists) {
        merged.push(pdfRestriction);
      }
    }
    
    return merged;
  }

  /**
   * Fusionne les droits en évitant les doublons
   */
  private mergeRights(standard: string[], pdf: string[]): string[] {
    const merged = [...standard];
    
    for (const pdfRight of pdf) {
      const exists = merged.some(existing => 
        this.areSimilarStrings(existing, pdfRight)
      );
      
      if (!exists) {
        merged.push(pdfRight);
      }
    }
    
    return merged;
  }

  /**
   * Vérifie si deux chaînes sont similaires (éviter doublons)
   */
  private areSimilarStrings(str1: string, str2: string, threshold = 0.8): boolean {
    const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    if (s1 === s2) return true;
    
    // Vérifier si une chaîne contient l'autre
    if (s1.includes(s2) || s2.includes(s1)) {
      return s1.length > 0 && s2.length > 0 && 
             (s1.length / s2.length > threshold || s2.length / s1.length > threshold);
    }
    
    return false;
  }

  /**
   * Vérifier si le service PDF est disponible
   */
  public isPDFExtractionAvailable(): boolean {
    return pluExtractorService !== null;
  }

  /**
   * Analyse complète d'une parcelle par adresse
   */
  async analyzeByAddress(address: string, withPDF = false): Promise<PLUAnalysisResult> {
    if (withPDF && pluExtractorService) {
      const enhanced = await this.analyzeByAddressWithPDFExtraction(address, { extractFromPDF: true });
      // Retirer pdfAnalysis pour compatibilité avec l'interface existante
      const { pdfAnalysis, ...result } = enhanced;
      return result;
    }
    
    // Méthode existante conservée pour compatibilité
    console.log(`🚀 Analyse standard pour: ${address}`);
    
    try {
      // 1. Recherche de l'adresse
      const addressData = await this.searchAddress(address);
      
      // 2. Récupération des données cadastrales
      const parcelData = await this.getParcelData(addressData.x, addressData.y);
      
      // 3. Récupération de la zone d'urbanisme
      const zoneData = await this.getUrbanZoneData(addressData.x, addressData.y);
      
      // 4. Récupération des servitudes
      const servitudes = await this.getServitudes(addressData.x, addressData.y);
      
      // 5. Analyse du règlement (version standard)
      const analysis = this.analyzeReglement(zoneData);
      
      // 6. Compilation des documents
      const documents = [
        {
          name: `Règlement de zone ${zoneData.libelle}`,
          url: zoneData.urlfic || '',
          type: 'reglement' as const
        },
        {
          name: 'Plan de zonage',
          url: '',
          type: 'zonage' as const
        }
      ];

      console.log(`✅ Analyse standard terminée pour: ${addressData.label}`);

      return {
        address: addressData,
        parcel: parcelData,
        zone: zoneData,
        servitudes,
        restrictions: analysis.restrictions,
        rights: analysis.rights,
        documents
      };
    } catch (error) {
      console.error(`❌ Erreur lors de l'analyse de "${address}":`, error);
      
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Erreur lors de l\'analyse de la parcelle');
    }
  }

  /**
   * Valide et nettoie une adresse
   */
  private validateAndCleanAddress(address: string): string {
    const cleaned = address.trim()
      .replace(/\s+/g, ' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Supprime les accents
      .trim();
    
    if (cleaned.length < 5) {
      throw new Error('Adresse trop courte');
    }
    
    return cleaned;
  }

  /**
   * Recherche d'adresse via l'API BAN avec stratégies multiples
   */
  async searchAddress(address: string): Promise<AddressData> {
    const cleanAddress = this.validateAndCleanAddress(address);
    
    console.log(`🔍 Recherche d'adresse: "${cleanAddress}"`);
    
    try {
      // Stratégie 1: Recherche exacte
      let response = await fetch(`${this.BAN_URL}?q=${encodeURIComponent(cleanAddress)}&limit=5`);
      
      if (!response.ok) {
        throw new Error(`Erreur API BAN: ${response.status}`);
      }
      
      let data = await response.json();
      console.log(`📍 Résultats trouvés: ${data.features?.length || 0}`);
      
      if (data.features && data.features.length > 0) {
        // Prendre le meilleur résultat avec un score acceptable
        const bestResult = data.features.find((f: any) => f.properties.score >= 0.5) || data.features[0];
        
        if (bestResult) {
          console.log(`✅ Adresse trouvée: ${bestResult.properties.label} (score: ${bestResult.properties.score})`);
          
          return {
            label: bestResult.properties.label,
            score: bestResult.properties.score,
            housenumber: bestResult.properties.housenumber,
            street: bestResult.properties.street,
            postcode: bestResult.properties.postcode,
            city: bestResult.properties.city,
            context: bestResult.properties.context,
            type: bestResult.properties.type,
            importance: bestResult.properties.importance,
            x: bestResult.geometry.coordinates[0],
            y: bestResult.geometry.coordinates[1]
          };
        }
      }

      // Stratégie 2: Recherche sans numéro si pas de résultats
      console.log(`🔄 Tentative de recherche sans numéro...`);
      const addressWithoutNumber = cleanAddress.replace(/^\d+\s*/, '').trim();
      
      if (addressWithoutNumber !== cleanAddress && addressWithoutNumber.length > 5) {
        response = await fetch(`${this.BAN_URL}?q=${encodeURIComponent(addressWithoutNumber)}&limit=5`);
        
        if (response.ok) {
          data = await response.json();
          console.log(`📍 Résultats sans numéro: ${data.features?.length || 0}`);
          
          if (data.features && data.features.length > 0) {
            const bestResult = data.features[0];
            console.log(`✅ Adresse approximative trouvée: ${bestResult.properties.label}`);
            
            return {
              label: bestResult.properties.label,
              score: bestResult.properties.score * 0.8, // Réduire le score car approximatif
              housenumber: bestResult.properties.housenumber,
              street: bestResult.properties.street,
              postcode: bestResult.properties.postcode,
              city: bestResult.properties.city,
              context: bestResult.properties.context,
              type: bestResult.properties.type,
              importance: bestResult.properties.importance,
              x: bestResult.geometry.coordinates[0],
              y: bestResult.geometry.coordinates[1]
            };
          }
        }
      }

      throw new Error(`Aucune adresse trouvée pour "${cleanAddress}". Vérifiez l'orthographe et le format.`);
      
    } catch (error) {
      console.error(`❌ Erreur lors de la recherche d'adresse:`, error);
      
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Erreur lors de la recherche d\'adresse');
    }
  }

  /**
   * Récupère les données de parcelle cadastrale avec fallback
   */
  async getParcelData(x: number, y: number): Promise<ParcelData> {
    try {
      console.log(`🗺️ Recherche de parcelle aux coordonnées: ${x}, ${y}`);
      
      const response = await fetch(`${this.CADASTRE_PARCEL_URL}?geom={"type":"Point","coordinates":[${x},${y}]}`);
      
      if (!response.ok) {
        throw new Error(`Erreur API Cadastre: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.features || data.features.length === 0) {
        console.warn(`⚠️ Aucune parcelle trouvée aux coordonnées exactes, création de données par défaut`);
        
        // Créer des données par défaut basées sur les coordonnées
        return {
          id: `UNKNOWN_${Math.round(x * 1000)}_${Math.round(y * 1000)}`,
          commune: 'Commune inconnue',
          prefixe: '000',
          section: 'XX',
          numero: '000',
          contenance: 0,
          geometry: {
            type: 'Point',
            coordinates: [[[x, y]]]
          }
        };
      }
      
      const feature = data.features[0];
      console.log(`✅ Parcelle trouvée: ${feature.properties.id}`);
      
      return {
        id: feature.properties.id,
        commune: feature.properties.commune,
        prefixe: feature.properties.prefixe,
        section: feature.properties.section,
        numero: feature.properties.numero,
        contenance: feature.properties.contenance,
        geometry: feature.geometry
      };
    } catch (error) {
      console.error(`❌ Erreur cadastre:`, error);
      
      // Retourner des données par défaut en cas d'erreur
      return {
        id: `ERROR_${Date.now()}`,
        commune: 'Données indisponibles',
        prefixe: '000',
        section: 'XX',
        numero: '000',
        contenance: 0,
        geometry: {
          type: 'Point',
          coordinates: [[[x, y]]]
        }
      };
    }
  }

  /**
   * Récupère les informations de zone d'urbanisme avec fallback
   */
  async getUrbanZoneData(x: number, y: number): Promise<ZoneUrbaData> {
    try {
      console.log(`🏛️ Recherche de zone d'urbanisme aux coordonnées: ${x}, ${y}`);
      
      const response = await fetch(`${this.GPU_ZONE_URL}?geom={"type":"Point","coordinates":[${x},${y}]}`);
      
      if (!response.ok) {
        throw new Error(`Erreur API GPU Zone: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.features || data.features.length === 0) {
        console.warn(`⚠️ Aucune zone d'urbanisme trouvée, utilisation de données par défaut`);
        
        return {
          libelle: 'Zone non définie',
          libelong: 'Zone d\'urbanisme non identifiée dans les données disponibles',
          typezone: 'UNKNOWN',
          destdomi: 'Non défini',
          nomfic: '',
          urlfic: '',
          datappro: '',
          datevalid: ''
        };
      }
      
      const feature = data.features[0];
      console.log(`✅ Zone d'urbanisme trouvée: ${feature.properties.libelle}`);
      
      return {
        libelle: feature.properties.libelle,
        libelong: feature.properties.libelong,
        typezone: feature.properties.typezone,
        destdomi: feature.properties.destdomi,
        nomfic: feature.properties.nomfic,
        urlfic: feature.properties.urlfic,
        datappro: feature.properties.datappro,
        datevalid: feature.properties.datevalid
      };
    } catch (error) {
      console.error(`❌ Erreur zone d'urbanisme:`, error);
      
      // Retourner des données par défaut
      return {
        libelle: 'Données indisponibles',
        libelong: 'Impossible de récupérer les informations de zonage',
        typezone: 'ERROR',
        destdomi: 'Non défini',
        nomfic: '',
        urlfic: '',
        datappro: '',
        datevalid: ''
      };
    }
  }

  /**
   * Récupère les servitudes d'utilité publique
   */
  async getServitudes(x: number, y: number): Promise<SupData[]> {
    const servitudes: SupData[] = [];
    const geom = `{"type":"Point","coordinates":[${x},${y}]}`;
    
    console.log(`📋 Recherche des servitudes aux coordonnées: ${x}, ${y}`);
    
    try {
      // Servitudes surfaciques
      const responseS = await fetch(`${this.GPU_SUP_S}?geom=${geom}`);
      if (responseS.ok) {
        const dataS = await responseS.json();
        if (dataS.features) {
          servitudes.push(...dataS.features.map((f: any) => ({
            categorie: 'Surfacique',
            libelle: f.properties.libelle,
            libelong: f.properties.libelong,
            nomfic: f.properties.nomfic,
            urlfic: f.properties.urlfic
          })));
        }
      }

      // Servitudes linéaires
      const responseL = await fetch(`${this.GPU_SUP_L}?geom=${geom}`);
      if (responseL.ok) {
        const dataL = await responseL.json();
        if (dataL.features) {
          servitudes.push(...dataL.features.map((f: any) => ({
            categorie: 'Linéaire',
            libelle: f.properties.libelle,
            libelong: f.properties.libelong,
            nomfic: f.properties.nomfic,
            urlfic: f.properties.urlfic
          })));
        }
      }

      // Servitudes ponctuelles
      const responseP = await fetch(`${this.GPU_SUP_P}?geom=${geom}`);
      if (responseP.ok) {
        const dataP = await responseP.json();
        if (dataP.features) {
          servitudes.push(...dataP.features.map((f: any) => ({
            categorie: 'Ponctuelle',
            libelle: f.properties.libelle,
            libelong: f.properties.libelong,
            nomfic: f.properties.nomfic,
            urlfic: f.properties.urlfic
          })));
        }
      }

      console.log(`✅ ${servitudes.length} servitude(s) trouvée(s)`);
      return servitudes;
    } catch (error) {
      console.warn('⚠️ Erreur lors de la récupération des servitudes:', error);
      return [];
    }
  }

  /**
   * Analyse le règlement PLU (version standard)
   */
  private analyzeReglement(zoneData: ZoneUrbaData): { restrictions: string[]; rights: string[] } {
    const restrictions: string[] = [];
    const rights: string[] = [];

    // Gestion des cas d'erreur
    if (zoneData.typezone === 'ERROR' || zoneData.typezone === 'UNKNOWN') {
      restrictions.push(
        "Données de zonage indisponibles",
        "Consulter le PLU en mairie pour connaître les règles applicables",
        "Vérifier auprès du service urbanisme de la commune"
      );
      rights.push(
        "Se renseigner en mairie pour les possibilités de construction",
        "Demander un certificat d'urbanisme pour plus de précisions"
      );
      return { restrictions, rights };
    }

    switch (zoneData.typezone?.toUpperCase()) {
      case 'U':
        restrictions.push(
          "Hauteur maximale selon le règlement de zone",
          "Coefficient d'occupation des sols limité",
          "Respect des reculs réglementaires",
          "Intégration architecturale obligatoire"
        );
        rights.push(
          "Construction d'habitation autorisée",
          "Extensions possibles sous conditions",
          "Commerces autorisés selon zonage",
          "Aménagements d'espaces extérieurs autorisés"
        );
        break;
      
      case 'AU':
        restrictions.push(
          "Zone à urbaniser - aménagement d'ensemble requis",
          "Respect des orientations d'aménagement et de programmation",
          "Équipements publics préalables nécessaires",
          "Densité et mixité imposées"
        );
        rights.push(
          "Urbanisation future possible",
          "Construction conditionnée à l'aménagement",
          "Participation aux équipements collectifs"
        );
        break;
      
      case 'A':
        restrictions.push(
          "Zone agricole - constructions très limitées",
          "Seules les constructions liées à l'exploitation agricole",
          "Protection des terres agricoles",
          "Interdiction de morcellement"
        );
        rights.push(
          "Constructions agricoles autorisées",
          "Logement de fonction sous conditions strictes",
          "Activités de diversification agricole possibles"
        );
        break;
      
      case 'N':
        restrictions.push(
          "Zone naturelle - constructions interdites",
          "Protection de l'environnement naturel",
          "Préservation des paysages",
          "Maintien de la biodiversité"
        );
        rights.push(
          "Aménagements légers d'accueil du public possibles",
          "Activités de loisirs compatibles avec l'environnement",
          "Restauration de constructions existantes sous conditions"
        );
        break;
      
      default:
        restrictions.push(
          `Règlement spécifique à la zone ${zoneData.libelle}`,
          "Consulter le règlement détaillé du PLU",
          "Respecter les prescriptions particulières"
        );
        rights.push(
          `Droits selon règlement de zone ${zoneData.libelle}`,
          "Se référer au document d'urbanisme en vigueur"
        );
    }

    return { restrictions, rights };
  }

  /**
   * NOUVELLE MÉTHODE: Extraction PDF directe (si service disponible)
   */
  async extractPLUFromPDF(pdfUrl: string, zone: string, options: {
    useAI?: boolean;
    forceRefresh?: boolean;
    timeout?: number;
  } = {}): Promise<any> {
    if (!pluExtractorService) {
      throw new Error('Service d\'extraction PDF non disponible. Installez les dépendances PDF.');
    }

    console.log(`📄 Extraction PDF directe: ${zone} depuis ${pdfUrl}`);
    
    try {
      return await pluExtractorService.extractFromPDF(pdfUrl, zone, {
        useAI: options.useAI ?? true,
        forceRefresh: options.forceRefresh ?? false,
        timeout: options.timeout ?? 60000
      });
    } catch (error) {
      console.error(`❌ Erreur extraction PDF:`, error);
      throw new Error(`Impossible d'extraire le PLU: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  /**
   * NOUVELLE MÉTHODE: Extraction de toutes les zones d'un PDF
   */
  async extractAllZonesFromPDF(pdfUrl: string, options: {
    useAI?: boolean;
    forceRefresh?: boolean;
  } = {}): Promise<any[]> {
    if (!pluExtractorService) {
      throw new Error('Service d\'extraction PDF non disponible. Installez les dépendances PDF.');
    }

    console.log(`📄 Extraction complète PDF: ${pdfUrl}`);
    
    try {
      return await pluExtractorService.extractAllZones(pdfUrl, {
        useAI: options.useAI ?? true,
        forceRefresh: options.forceRefresh ?? false
      });
    } catch (error) {
      console.error(`❌ Erreur extraction complète:`, error);
      throw new Error(`Impossible d'extraire toutes les zones: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }
}

// Export du service
export const pluApiService = new PLUApiService();