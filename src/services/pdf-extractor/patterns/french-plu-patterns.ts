// src/services/pdf-extractor/patterns/french-plu-patterns.ts

/**
 * Patterns de regex spécialisés pour l'extraction des PLU français
 * Basés sur l'analyse de centaines de règlements PLU français
 */

export interface ExtractionPattern {
    name: string;
    patterns: RegExp[];
    priority: number;
    validator?: (value: any) => boolean;
    transformer?: (value: any) => any;
  }
  
  /**
   * Patterns pour les hauteurs (mètres)
   */
  export const HAUTEUR_PATTERNS: ExtractionPattern = {
    name: 'hauteur',
    priority: 1,
    patterns: [
      // "hauteur maximale de 12 mètres"
      /hauteur[^.]*?maximale?[^.]*?(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)/gi,
      
      // "12 mètres au faîtage"
      /(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)[^.]*?faîtage/gi,
      
      // "ne peut excéder 15 m"
      /(?:excéder|dépasser|être\s+supérieure?\s+à)[^.]*?(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)/gi,
      
      // "hauteur : 12 m"
      /hauteur\s*:?\s*(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)/gi,
      
      // "12 m maximum"
      /(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)[^.]*?maximum/gi,
      
      // Patterns négatifs - "à l'acrotère"
      /(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)[^.]*?acrotère/gi,
    ],
    validator: (value: number) => value > 0 && value <= 50, // Hauteurs raisonnables
    transformer: (value: string) => parseFloat(value.replace(',', '.'))
  };
  
  /**
   * Patterns pour le nombre d'étages
   */
  export const ETAGES_PATTERNS: ExtractionPattern = {
    name: 'etages',
    priority: 1,
    patterns: [
      // "R+2", "R + 2", "RDC + 2"
      /R\s*(?:DC)?\s*\+\s*(\d+)/gi,
      
      // "rez-de-chaussée plus 2 étages"
      /rez[^.]*?plus\s*(\d+)\s*étages?/gi,
      
      // "2 étages maximum"
      /(\d+)\s*étages?[^.]*?maximum/gi,
      
      // "ne peut excéder 3 étages"
      /(?:excéder|dépasser)[^.]*?(\d+)\s*étages?/gi,
      
      // "étages : 2"
      /étages?\s*:?\s*(\d+)/gi,
    ],
    validator: (value: number) => value >= 0 && value <= 10,
    transformer: (value: string) => parseInt(value)
  };
  
  /**
   * Patterns pour l'emprise au sol (%)
   */
  export const EMPRISE_PATTERNS: ExtractionPattern = {
    name: 'emprise',
    priority: 1,
    patterns: [
      // "emprise au sol ne peut excéder 40%"
      /emprise[^.]*?sol[^.]*?(?:excéder|dépasser|supérieure?\s+à)[^.]*?(\d+(?:[.,]\d+)?)\s*%/gi,
      
      // "emprise au sol : 40%"
      /emprise[^.]*?sol\s*:?\s*(\d+(?:[.,]\d+)?)\s*%/gi,
      
      // "40% de la superficie"
      /(\d+(?:[.,]\d+)?)\s*%[^.]*?superficie[^.]*?terrain/gi,
      
      // "coefficient d'emprise de 0,4"
      /coefficient[^.]*?emprise[^.]*?(\d+(?:[.,]\d+)?)/gi,
      
      // "CES de 0,4" ou "CES : 0,4"
      /CES\s*[=:]\s*(\d+(?:[.,]\d+)?)/gi,
      
      // "40% maximum"
      /(\d+(?:[.,]\d+)?)\s*%[^.]*?maximum[^.]*?emprise/gi,
    ],
    validator: (value: number) => value > 0 && value <= 100,
    transformer: (value: string) => {
      const num = parseFloat(value.replace(',', '.'));
      return num <= 1 ? num * 100 : num; // Convertir 0.4 en 40%
    }
  };
  
  /**
   * Patterns pour les reculs (mètres)
   */
  export const RECUL_PATTERNS: ExtractionPattern = {
    name: 'recul',
    priority: 1,
    patterns: [
      // "recul minimum de 5 mètres"
      /recul[^.]*?minimum[^.]*?(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)/gi,
      
      // "5 mètres de recul"
      /(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)[^.]*?recul/gi,
      
      // "implantation à 3 mètres minimum"
      /implantation[^.]*?(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)[^.]*?minimum/gi,
      
      // "distance de 4 m de la voirie"
      /distance[^.]*?(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)[^.]*?voirie/gi,
      
      // "retrait de 6 mètres"
      /retrait[^.]*?(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)/gi,
      
      // Spécifique voirie
      /(?:voirie|alignement|domaine\s+public)[^.]*?(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)/gi,
      
      // Spécifique limites séparatives
      /limites?\s+séparatives?[^.]*?(\d+(?:[.,]\d+)?)\s*(?:mètres?|m\b)/gi,
    ],
    validator: (value: number) => value >= 0 && value <= 50,
    transformer: (value: string) => parseFloat(value.replace(',', '.'))
  };
  
  /**
   * Patterns pour le stationnement
   */
  export const STATIONNEMENT_PATTERNS: ExtractionPattern = {
    name: 'stationnement',
    priority: 1,
    patterns: [
      // "1 place par logement"
      /(\d+(?:[.,]\d+)?)\s*places?[^.]*?(?:par\s+)?logements?/gi,
      
      // "2 places pour les logements de plus de 80 m²"
      /(\d+(?:[.,]\d+)?)\s*places?[^.]*?logements?[^.]*?(\d+)\s*m²/gi,
      
      // "1 place pour 40 m² de bureaux"
      /(\d+(?:[.,]\d+)?)\s*places?[^.]*?(\d+)\s*m²[^.]*?bureaux?/gi,
      
      // "stationnement : 1 place/logement"
      /stationnement\s*:?\s*(\d+(?:[.,]\d+)?)\s*places?[\/\s]*logements?/gi,
      
      // "1 place pour 50 m² de surface commerciale"
      /(\d+(?:[.,]\d+)?)\s*places?[^.]*?(\d+)\s*m²[^.]*?(?:commerce|vente)/gi,
    ],
    validator: (value: number) => value >= 0 && value <= 10,
    transformer: (value: string) => parseFloat(value.replace(',', '.'))
  };
  
  /**
   * Patterns pour les espaces verts (%)
   */
  export const ESPACES_VERTS_PATTERNS: ExtractionPattern = {
    name: 'espacesVerts',
    priority: 1,
    patterns: [
      // "30% d'espaces verts"
      /(\d+(?:[.,]\d+)?)\s*%[^.]*?espaces?\s+verts?/gi,
      
      // "espaces verts : 25% minimum"
      /espaces?\s+verts?[^.]*?(\d+(?:[.,]\d+)?)\s*%/gi,
      
      // "espaces libres de 20%"
      /espaces?\s+libres?[^.]*?(\d+(?:[.,]\d+)?)\s*%/gi,
      
      // "coefficient d'espaces verts de 0,3"
      /coefficient[^.]*?espaces?\s+verts?[^.]*?(\d+(?:[.,]\d+)?)/gi,
      
      // "plantations sur 25% de la parcelle"
      /plantations?[^.]*?(\d+(?:[.,]\d+)?)\s*%[^.]*?parcelle/gi,
    ],
    validator: (value: number) => value >= 0 && value <= 100,
    transformer: (value: string) => {
      const num = parseFloat(value.replace(',', '.'));
      return num <= 1 ? num * 100 : num;
    }
  };
  
  /**
   * Patterns pour les usages autorisés/interdits
   */
  export const USAGE_PATTERNS = {
    TYPES_USAGE: [
      'habitation', 'logement', 'résidentiel',
      'bureau', 'bureaux', 'activités tertiaires',
      'commerce', 'commerces', 'activités commerciales',
      'artisanat', 'activités artisanales',
      'industrie', 'industriel', 'activités industrielles',
      'entrepôt', 'entrepôts', 'stockage',
      'équipement public', 'équipements collectifs',
      'hébergement hôtelier', 'hôtel', 'hôtellerie',
      'restaurant', 'restauration',
      'stationnement', 'garage',
      'agriculture', 'agricole'
    ],
  
    INTERDICTION: [
      /sont\s+interdites?\s*:?([^.]+)/gi,
      /occupations?[^.]*?interdites?\s*:?([^.]+)/gi,
      /ne\s+sont\s+pas\s+autorisées?\s*:?([^.]+)/gi,
      /prohibées?\s*:?([^.]+)/gi
    ],
  
    AUTORISATION: [
      /sont\s+autorisées?\s*:?([^.]+)/gi,
      /occupations?[^.]*?autorisées?\s*:?([^.]+)/gi,
      /constructions?\s+autorisées?\s*:?([^.]+)/gi,
      /sont\s+admises?\s*:?([^.]+)/gi
    ],
  
    CONDITIONS: [
      /soumises?\s+à\s+conditions?\s*:?([^.]+)/gi,
      /sous\s+conditions?\s*:?([^.]+)/gi,
      /conditions?\s+particulières?\s*:?([^.]+)/gi
    ]
  };
  
  /**
   * Patterns pour les prescriptions architecturales
   */
  export const ARCHITECTURAL_PATTERNS = {
    MATERIAUX: [
      /matériaux?\s+(?:autorisés?|imposés?|interdits?)\s*:?([^.]+)/gi,
      /revêtements?\s*:?([^.]+)/gi,
      /parements?\s*:?([^.]+)/gi,
      /façades?\s*:?([^.]+matériaux?[^.]*)/gi
    ],
  
    TOITURES: [
      /toitures?\s*:?([^.]+)/gi,
      /couvertures?\s*:?([^.]+)/gi,
      /pentes?\s+de\s+toiture[^.]*?(\d+(?:[.,]\d+)?)\s*%/gi,
      /tuiles?\s+([^.]+)/gi
    ],
  
    COULEURS: [
      /couleurs?\s*:?([^.]+)/gi,
      /teintes?\s*:?([^.]+)/gi,
      /coloris\s*:?([^.]+)/gi,
      /aspect\s+extérieur[^.]*?couleurs?\s*:?([^.]+)/gi
    ]
  };
  
  /**
   * Patterns pour détecter les zones PLU
   */
  export const ZONE_DETECTION_PATTERNS = [
    // "ZONE UB - Zone urbaine mixte"
    /ZONE\s+([A-Z]{1,3}\d*[A-Z]*)\s*[-–—]\s*([^\n\r]+)/gi,
    
    // "Article UB1 - Occupations..."
    /Article\s+([A-Z]{1,3}\d*[A-Z]*)\s*(\d+)\s*[-–—]/gi,
    
    // "SECTEUR AU1"
    /SECTEUR\s+([A-Z]{1,3}\d*[A-Z]*)/gi,
    
    // "DISPOSITIONS APPLICABLES À LA ZONE UA"
    /DISPOSITIONS\s+APPLICABLES\s+À\s+LA\s+ZONE\s+([A-Z]{1,3}\d*[A-Z]*)/gi,
    
    // Patterns pour articles spécifiques
    /([A-Z]{1,3}\d*[A-Z]*)\s*-?\s*(\d+)\s*[-–—]\s*([^\n\r]+)/gi
  ];
  
  /**
   * Articles standards des PLU français
   */
  export const ARTICLES_PLU_STANDARDS = {
    1: 'Occupations et utilisations du sol interdites',
    2: 'Occupations et utilisations du sol soumises à conditions particulières',
    3: 'Conditions de desserte des terrains par les voies publiques ou privées',
    4: 'Conditions de desserte des terrains par les réseaux publics',
    5: 'Superficie minimale des terrains constructibles',
    6: 'Implantation des constructions par rapport aux voies et emprises publiques',
    7: 'Implantation des constructions par rapport aux limites séparatives',
    8: 'Implantation des constructions les unes par rapport aux autres sur une même propriété',
    9: 'Emprise au sol des constructions',
    10: 'Hauteur maximale des constructions',
    11: 'Aspect extérieur des constructions et aménagement de leurs abords',
    12: 'Obligations imposées aux constructeurs en matière de réalisation d\'aires de stationnement',
    13: 'Obligations imposées aux constructeurs en matière de réalisation d\'espaces libres, d\'aires de jeux et de loisirs, et de plantations',
    14: 'Coefficient d\'occupation du sol'
  };
  
  /**
   * Mots-clés de qualité pour valider l'extraction
   */
  export const QUALITY_KEYWORDS = [
    'article', 'construction', 'terrain', 'parcelle', 'zone',
    'hauteur', 'emprise', 'recul', 'implantation', 'stationnement',
    'règlement', 'urbanisme', 'aménagement', 'desserte'
  ];
  
  /**
   * Patterns de nettoyage du texte
   */
  export const TEXT_CLEANING_PATTERNS = [
    // Supprimer les numéros de page
    { pattern: /page\s+\d+/gi, replacement: '' },
    
    // Normaliser les tirets
    { pattern: /[–—]/g, replacement: '-' },
    
    // Normaliser les guillemets
    { pattern: /[""]/g, replacement: '"' },
    { pattern: /['']/g, replacement: "'" },
    
    // Supprimer les caractères de contrôle
    { pattern: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, replacement: '' },
    
    // Normaliser les espaces multiples
    { pattern: /\s+/g, replacement: ' ' },
    
    // Supprimer les espaces en début/fin de ligne
    { pattern: /^\s+|\s+$/gm, replacement: '' }
  ];
  
  /**
   * Fonction utilitaire pour appliquer un pattern avec validation
   */
  export function applyPattern(text: string, pattern: ExtractionPattern): any[] {
    const results: any[] = [];
    
    for (const regex of pattern.patterns) {
      const matches = text.matchAll(regex);
      
      for (const match of matches) {
        if (match[1]) {
          let value = match[1].trim();
          
          // Appliquer le transformateur si défini
          if (pattern.transformer) {
            try {
              value = pattern.transformer(value);
            } catch (error) {
              continue; // Ignorer si transformation échoue
            }
          }
          
          // Valider si défini
          if (pattern.validator && !pattern.validator(value)) {
            continue;
          }
          
          results.push({
            value,
            match: match[0],
            pattern: regex.source,
            priority: pattern.priority
          });
        }
      }
    }
    
    // Trier par priorité et retourner les meilleurs résultats
    return results
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 5); // Limiter à 5 meilleurs résultats
  }
  
  /**
   * Fonction pour nettoyer le texte extrait
   */
  export function cleanExtractedText(text: string): string {
    let cleaned = text;
    
    // Appliquer tous les patterns de nettoyage
    for (const { pattern, replacement } of TEXT_CLEANING_PATTERNS) {
      cleaned = cleaned.replace(pattern, replacement);
    }
    
    return cleaned.trim();
  }
  
  /**
   * Fonction pour détecter le type de zone
   */
  export function getZoneType(zone: string): 'U' | 'AU' | 'A' | 'N' | 'UNKNOWN' {
    const zoneUpper = zone.toUpperCase();
    
    if (zoneUpper.startsWith('U')) return 'U';
    if (zoneUpper.startsWith('AU') || zoneUpper.includes('AU')) return 'AU';
    if (zoneUpper.startsWith('A') && !zoneUpper.startsWith('AU')) return 'A';
    if (zoneUpper.startsWith('N')) return 'N';
    
    return 'UNKNOWN';
  }
  
  /**
   * Configuration des zones avec règles par défaut
   */
  export const ZONE_DEFAULT_RULES = {
    U: {
      description: 'Zone urbaine équipée',
      restrictions: [
        'Respect des règles d\'implantation',
        'Intégration architecturale obligatoire',
        'Respect des reculs réglementaires'
      ],
      rights: [
        'Construction d\'habitation autorisée',
        'Extensions possibles sous conditions',
        'Aménagements d\'espaces extérieurs autorisés'
      ]
    },
    AU: {
      description: 'Zone à urbaniser',
      restrictions: [
        'Aménagement d\'ensemble requis',
        'Équipements publics préalables nécessaires',
        'Respect des orientations d\'aménagement'
      ],
      rights: [
        'Urbanisation future possible',
        'Construction conditionnée à l\'aménagement'
      ]
    },
    A: {
      description: 'Zone agricole',
      restrictions: [
        'Constructions très limitées',
        'Protection des terres agricoles',
        'Seules les constructions liées à l\'exploitation'
      ],
      rights: [
        'Constructions agricoles autorisées',
        'Logement de fonction sous conditions strictes'
      ]
    },
    N: {
      description: 'Zone naturelle',
      restrictions: [
        'Constructions interdites',
        'Protection de l\'environnement naturel',
        'Préservation des paysages'
      ],
      rights: [
        'Aménagements légers d\'accueil du public possibles',
        'Restauration de constructions existantes sous conditions'
      ]
    }
  };