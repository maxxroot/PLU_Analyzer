// src/services/plu-api.service.ts
import { 
  AddressData, 
  ParcelData, 
  ZoneUrbaData, 
  SupData, 
  PLUAnalysisResult 
} from '../types/plu.types';

export class PLUApiService {
  private readonly BAN_URL = "https://api-adresse.data.gouv.fr/search/";
  private readonly CADASTRE_PARCEL_URL = "https://apicarto.ign.fr/api/cadastre/parcelle";
  private readonly GPU_ZONE_URL = "https://apicarto.ign.fr/api/gpu/zone-urba";
  private readonly GPU_SUP_S = "https://apicarto.ign.fr/api/gpu/assiette-sup-s";
  private readonly GPU_SUP_L = "https://apicarto.ign.fr/api/gpu/assiette-sup-l";
  private readonly GPU_SUP_P = "https://apicarto.ign.fr/api/gpu/assiette-sup-p";

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

      // Stratégie 3: Recherche par ville uniquement
      console.log(`🔄 Tentative de recherche par ville uniquement...`);
      const cityMatch = cleanAddress.match(/\d{5}\s+([^,]+)/);
      
      if (cityMatch) {
        const cityName = cityMatch[1].trim();
        response = await fetch(`${this.BAN_URL}?q=${encodeURIComponent(cityName)}&type=municipality&limit=1`);
        
        if (response.ok) {
          data = await response.json();
          
          if (data.features && data.features.length > 0) {
            const cityResult = data.features[0];
            console.log(`✅ Ville trouvée: ${cityResult.properties.label}`);
            
            return {
              label: cityResult.properties.label,
              score: 0.3, // Score faible car très approximatif
              housenumber: undefined,
              street: undefined,
              postcode: cityResult.properties.postcode,
              city: cityResult.properties.city,
              context: cityResult.properties.context,
              type: 'municipality',
              importance: cityResult.properties.importance,
              x: cityResult.geometry.coordinates[0],
              y: cityResult.geometry.coordinates[1]
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
   * Analyse le règlement PLU
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
   * Analyse complète d'une parcelle par adresse
   */
  async analyzeByAddress(address: string): Promise<PLUAnalysisResult> {
    console.log(`🚀 Début de l'analyse pour: ${address}`);
    
    try {
      // 1. Recherche de l'adresse
      const addressData = await this.searchAddress(address);
      
      // 2. Récupération des données cadastrales
      const parcelData = await this.getParcelData(addressData.x, addressData.y);
      
      // 3. Récupération de la zone d'urbanisme
      const zoneData = await this.getUrbanZoneData(addressData.x, addressData.y);
      
      // 4. Récupération des servitudes
      const servitudes = await this.getServitudes(addressData.x, addressData.y);
      
      // 5. Analyse du règlement
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

      console.log(`✅ Analyse terminée avec succès pour: ${addressData.label}`);

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
   * Analyse complète d'une parcelle par référence cadastrale
   */
  async analyzeByCadastre(codePostal: string, commune: string, parcelle: string): Promise<PLUAnalysisResult> {
    try {
      // Recherche de l'adresse approximative via la commune et le code postal
      const searchQuery = `${commune} ${codePostal}`;
      console.log(`🗺️ Recherche par cadastre: ${searchQuery}`);
      
      const addressData = await this.searchAddress(searchQuery);
      
      // Le reste de l'analyse est similaire
      return this.analyzeByAddress(addressData.label);
    } catch (error) {
      console.error(`❌ Erreur lors de l'analyse par cadastre:`, error);
      
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Erreur lors de l\'analyse par référence cadastrale');
    }
  }
}

// Export du service
export const pluApiService = new PLUApiService();