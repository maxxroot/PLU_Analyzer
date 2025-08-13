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

import { 
  PDFDocumentService, 
  PLUDocument, 
  DocumentDownloadResult 
} from './pdf-document.service';

// Import conditionnel du service d'extraction PDF
let pluExtractorService: any = null;
try {
  const extractorModule = require('./pdf-extractor/plu-extractor.service');
  pluExtractorService = extractorModule.pluExtractorService;
} catch (error) {
  console.warn('Service d\'extraction PDF non disponible:', error);
}

// Interface enrichie pour les résultats avec documents téléchargés
export interface EnhancedPLUAnalysisResult extends PLUAnalysisResult {
  downloadedDocuments?: PLUDocument[];
  documentDownloadSummary?: {
    total: number;
    downloaded: number;
    cached: number;
    failed: number;
  };
}

export class PLUApiService {
  private readonly BAN_URL = "https://api-adresse.data.gouv.fr/search/";
  private readonly CADASTRE_PARCEL_URL = "https://apicarto.ign.fr/api/cadastre/parcelle";
  private readonly GPU_ZONE_URL = "https://apicarto.ign.fr/api/gpu/zone-urba";
  private readonly GPU_SUP_S = "https://apicarto.ign.fr/api/gpu/assiette-sup-s";
  private readonly GPU_SUP_L = "https://apicarto.ign.fr/api/gpu/assiette-sup-l";
  private readonly GPU_SUP_P = "https://apicarto.ign.fr/api/gpu/assiette-sup-p";

  private cadastreService: CadastreSearchService;
  private pdfDocumentService: PDFDocumentService;

  constructor() {
    this.cadastreService = new CadastreSearchService();
    this.pdfDocumentService = new PDFDocumentService();
  }

  /**
   * NOUVELLE MÉTHODE: Analyse avec téléchargement automatique des documents
   */
  async analyzeWithDocumentDownload(
    type: 'address' | 'cadastre',
    params: any,
    options: {
      downloadDocuments?: boolean;
      downloadTimeout?: number;
    } = {}
  ): Promise<EnhancedPLUAnalysisResult> {
    console.log(`🚀 Analyse enrichie avec téléchargement de documents`);
    
    try {
      // 1. Effectuer l'analyse standard
      let standardResult: PLUAnalysisResult;
      
      if (type === 'address') {
        standardResult = await this.analyzeByAddress(params.address);
      } else {
        standardResult = await this.analyzeByCadastre(params.codePostal, params.commune, params.numeroParcelle);
      }

      // 2. Télécharger les documents si demandé
      let downloadedDocuments: PLUDocument[] = [];
      let documentDownloadSummary = {
        total: 0,
        downloaded: 0,
        cached: 0,
        failed: 0
      };

      if (options.downloadDocuments !== false) {
        console.log(`📚 Téléchargement des documents PLU...`);
        
        // Préparer la liste des documents à télécharger
        const documentsToDownload = await this.prepareDocumentList(standardResult);
        documentDownloadSummary.total = documentsToDownload.length;

        if (documentsToDownload.length > 0) {
          console.log(`📄 ${documentsToDownload.length} document(s) à télécharger`);
          
          // Télécharger les documents
          const downloadResults = await this.pdfDocumentService.downloadDocuments(documentsToDownload);
          
          // Traiter les résultats
          downloadResults.forEach(result => {
            if (result.success && result.document) {
              downloadedDocuments.push(result.document);
              if (result.cached) {
                documentDownloadSummary.cached++;
              } else {
                documentDownloadSummary.downloaded++;
              }
            } else {
              documentDownloadSummary.failed++;
              // Ajouter quand même le document avec l'erreur
              if (result.document) {
                downloadedDocuments.push(result.document);
              }
            }
          });

          console.log(`📊 Téléchargement terminé:`, documentDownloadSummary);
        }
      }

      // 3. Enrichir le résultat standard
      const enhancedResult: EnhancedPLUAnalysisResult = {
        ...standardResult,
        downloadedDocuments,
        documentDownloadSummary
      };

      return enhancedResult;

    } catch (error) {
      console.error(`❌ Erreur analyse enrichie:`, error);
      throw error;
    }
  }

  /**
   * Prépare la liste des documents à télécharger depuis le résultat d'analyse
   */
  private async prepareDocumentList(result: PLUAnalysisResult): Promise<{ name: string; url: string }[]> {
    const documentsToDownload: { name: string; url: string }[] = [];

    // 1. Document de règlement principal (zone)
    if (result.zone.urlfic && result.zone.urlfic.startsWith('http')) {
      documentsToDownload.push({
        name: `Règlement zone ${result.zone.libelle}`,
        url: result.zone.urlfic
      });
    }

    // 2. Documents des servitudes
    result.servitudes?.forEach(servitude => {
      if (servitude.urlfic && servitude.urlfic.startsWith('http')) {
        documentsToDownload.push({
          name: `Servitude - ${servitude.libelle}`,
          url: servitude.urlfic
        });
      }
    });

    // 3. Documents standards PLU (si disponibles via des URLs connues)
    const additionalDocs = await this.findAdditionalPLUDocuments(result);
    documentsToDownload.push(...additionalDocs);

    // Dédupliquer par URL
    const uniqueDocuments = documentsToDownload.filter((doc, index, self) => 
      index === self.findIndex(d => d.url === doc.url)
    );

    console.log(`📋 ${uniqueDocuments.length} document(s) unique(s) préparé(s)`);
    return uniqueDocuments;
  }

  /**
   * Recherche des documents PLU supplémentaires (patterns d'URLs connues)
   */
  private async findAdditionalPLUDocuments(result: PLUAnalysisResult): Promise<{ name: string; url: string }[]> {
    const additionalDocs: { name: string; url: string }[] = [];

    try {
      // Extraire le domaine de base depuis l'URL du règlement
      if (result.zone.urlfic) {
        const baseUrl = new URL(result.zone.urlfic);
        const baseDomain = `${baseUrl.protocol}//${baseUrl.hostname}`;
        const basePath = result.zone.urlfic.substring(0, result.zone.urlfic.lastIndexOf('/'));

        // Patterns d'URLs courantes pour les documents PLU
        const commonDocuments = [
          { name: 'Plan de zonage', patterns: ['zonage', 'plan', 'zonage.pdf', 'plan_zonage.pdf'] },
          { name: 'Orientations d\'aménagement', patterns: ['oap', 'orientations', 'amenagement'] },
          { name: 'Rapport de présentation', patterns: ['rapport', 'presentation', 'justification'] },
          { name: 'Annexes', patterns: ['annexes', 'annexe'] }
        ];

        // Tester les patterns courants
        for (const doc of commonDocuments) {
          for (const pattern of doc.patterns) {
            const testUrls = [
              `${basePath}/${pattern}.pdf`,
              `${basePath}/documents/${pattern}.pdf`,
              `${basePath}/plu_${pattern}.pdf`,
              `${baseDomain}/documents/urbanisme/${pattern}.pdf`
            ];

            for (const testUrl of testUrls) {
              try {
                // Test rapide de l'existence du document (HEAD request)
                const response = await fetch(testUrl, { 
                  method: 'HEAD',
                  signal: AbortSignal.timeout(5000) // 5s timeout
                });
                
                if (response.ok && response.headers.get('content-type')?.includes('pdf')) {
                  console.log(`📄 Document supplémentaire trouvé: ${testUrl}`);
                  additionalDocs.push({
                    name: doc.name,
                    url: testUrl
                  });
                  break; // Prendre le premier trouvé pour ce type
                }
              } catch (error) {
                // Ignorer les erreurs de test URL
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn('⚠️ Erreur recherche documents supplémentaires:', error);
    }

    return additionalDocs;
  }

  /**
   * NOUVELLE MÉTHODE: Analyse par adresse avec téléchargement
   */
  async analyzeByAddressWithDownload(
    address: string, 
    options: { downloadDocuments?: boolean } = {}
  ): Promise<EnhancedPLUAnalysisResult> {
    return this.analyzeWithDocumentDownload('address', { address }, options);
  }

  /**
   * NOUVELLE MÉTHODE: Analyse par cadastre avec téléchargement
   */
  async analyzeByCadastreWithDownload(
    codePostal: string, 
    commune: string, 
    numeroParcelle: string,
    options: { downloadDocuments?: boolean } = {}
  ): Promise<EnhancedPLUAnalysisResult> {
    return this.analyzeWithDocumentDownload('cadastre', { 
      codePostal, 
      commune, 
      numeroParcelle 
    }, options);
  }

  /**
   * NOUVELLE MÉTHODE: Récupération d'un document par son ID
   */
  async getDocument(documentId: string): Promise<{ found: boolean; path?: string; contentType?: string }> {
    return this.pdfDocumentService.getDocumentFromCache(documentId);
  }

  /**
   * NOUVELLE MÉTHODE: Statistiques des documents en cache
   */
  async getDocumentCacheStats() {
    return this.pdfDocumentService.getCacheStats();
  }

  /**
   * NOUVELLE MÉTHODE: Nettoyage du cache des documents
   */
  async cleanDocumentCache(maxAgeMs?: number) {
    return this.pdfDocumentService.cleanCache(maxAgeMs);
  }

  // ... [Conserver toutes les méthodes existantes] ...

  /**
   * Analyse complète d'une parcelle par référence cadastrale
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
        score: 0.95,
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

  // ... [Toutes les autres méthodes existantes restent identiques] ...

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

  /**
   * Analyse complète d'une parcelle par adresse
   */
  async analyzeByAddress(address: string, withPDF = false): Promise<PLUAnalysisResult> {
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
   * Recherche d'adresse via l'API BAN
   */
  async searchAddress(address: string): Promise<AddressData> {
    const cleanAddress = address.trim().replace(/\s+/g, ' ');
    
    console.log(`🔍 Recherche d'adresse: "${cleanAddress}"`);
    
    try {
      const response = await fetch(`${this.BAN_URL}?q=${encodeURIComponent(cleanAddress)}&limit=5`);
      
      if (!response.ok) {
        throw new Error(`Erreur API BAN: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const bestResult = data.features[0];
        
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

      throw new Error(`Aucune adresse trouvée pour "${cleanAddress}"`);
      
    } catch (error) {
      console.error(`❌ Erreur recherche adresse:`, error);
      throw error;
    }
  }

  /**
   * Récupère les données de parcelle cadastrale
   */
  async getParcelData(x: number, y: number): Promise<ParcelData> {
    try {
      const response = await fetch(`${this.CADASTRE_PARCEL_URL}?geom={"type":"Point","coordinates":[${x},${y}]}`);
      
      if (!response.ok) {
        throw new Error(`Erreur API Cadastre: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.features || data.features.length === 0) {
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
   * Récupère les informations de zone d'urbanisme
   */
  async getUrbanZoneData(x: number, y: number): Promise<ZoneUrbaData> {
    try {
      const response = await fetch(`${this.GPU_ZONE_URL}?geom={"type":"Point","coordinates":[${x},${y}]}`);
      
      if (!response.ok) {
        throw new Error(`Erreur API GPU Zone: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.features || data.features.length === 0) {
        return {
          libelle: 'Zone non définie',
          libelong: 'Zone d\'urbanisme non identifiée',
          typezone: 'UNKNOWN',
          destdomi: 'Non défini',
          nomfic: '',
          urlfic: '',
          datappro: '',
          datevalid: ''
        };
      }
      
      const feature = data.features[0];
      
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

      return servitudes;
    } catch (error) {
      console.warn('⚠️ Erreur servitudes:', error);
      return [];
    }
  }

  /**
   * Analyse le règlement PLU
   */
  private analyzeReglement(zoneData: ZoneUrbaData): { restrictions: string[]; rights: string[] } {
    const restrictions: string[] = [];
    const rights: string[] = [];

    if (zoneData.typezone === 'ERROR' || zoneData.typezone === 'UNKNOWN') {
      restrictions.push(
        "Données de zonage indisponibles",
        "Consulter le PLU en mairie"
      );
      rights.push(
        "Se renseigner en mairie pour les possibilités"
      );
      return { restrictions, rights };
    }

    switch (zoneData.typezone?.toUpperCase()) {
      case 'U':
        restrictions.push(
          "Hauteur maximale selon règlement",
          "Coefficient d'occupation limité",
          "Respect des reculs réglementaires"
        );
        rights.push(
          "Construction d'habitation autorisée",
          "Extensions possibles sous conditions"
        );
        break;
      
      case 'AU':
        restrictions.push(
          "Zone à urbaniser - aménagement d'ensemble requis",
          "Équipements publics préalables nécessaires"
        );
        rights.push(
          "Urbanisation future possible",
          "Construction conditionnée"
        );
        break;
      
      case 'A':
        restrictions.push(
          "Zone agricole - constructions très limitées",
          "Protection des terres agricoles"
        );
        rights.push(
          "Constructions agricoles autorisées",
          "Logement de fonction sous conditions"
        );
        break;
      
      case 'N':
        restrictions.push(
          "Zone naturelle - constructions interdites",
          "Protection de l'environnement"
        );
        rights.push(
          "Aménagements légers possibles",
          "Restauration sous conditions"
        );
        break;
      
      default:
        restrictions.push(
          `Règlement spécifique zone ${zoneData.libelle}`,
          "Consulter le règlement détaillé"
        );
        rights.push(
          `Droits selon règlement ${zoneData.libelle}`
        );
    }

    return { restrictions, rights };
  }
}

// Export du service
export const pluApiService = new PLUApiService();