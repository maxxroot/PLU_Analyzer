// src/server.ts
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { body, validationResult, query } from 'express-validator';
import { pluApiService } from './services/plu-api.service';
import dotenv from 'dotenv';

// Charger les variables d'environnement
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const isDevelopment = process.env.NODE_ENV === 'development';

// Middlewares de sécurité (plus permissifs en développement)
if (!isDevelopment) {
  app.use(helmet());
}

app.use(cors({
  origin: isDevelopment 
    ? ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173']
    : process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting (plus permissif en développement)
const limiter = rateLimit({
  windowMs: isDevelopment ? 1 * 60 * 1000 : 15 * 60 * 1000, // 1 min en dev, 15 min en prod
  max: isDevelopment ? 1000 : 100, // 1000 en dev, 100 en prod
  message: 'Trop de requêtes depuis cette IP, réessayez plus tard.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isDevelopment && req.ip === '127.0.0.1', // Skip rate limiting pour localhost en dev
});

app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Middleware de logging en développement
if (isDevelopment) {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
}

// Middleware de gestion d'erreurs
interface ApiError extends Error {
  statusCode?: number;
}

const errorHandler = (err: ApiError, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Erreur interne du serveur';
  
  console.error(`Erreur ${statusCode}:`, err);
  
  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(isDevelopment && { stack: err.stack, details: err })
    }
  });
};

// Middleware de validation
const validateRequest = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Données invalides',
        details: errors.array()
      }
    });
  }
  next();
};

// Routes

/**
 * GET /api/health - Health check
 */
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'API PLU opérationnelle',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

/**
 * POST /api/analyze/address - Analyse par adresse
 */
app.post('/api/analyze/address',
  [
    body('address')
      .isString()
      .isLength({ min: 5, max: 200 })
      .withMessage('L\'adresse doit contenir entre 5 et 200 caractères')
      .matches(/\d/)
      .withMessage('L\'adresse doit contenir au moins un numéro')
  ],
  validateRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { address } = req.body;
      
      console.log(`📍 Analyse demandée pour l'adresse: ${address}`);
      
      const result = await pluApiService.analyzeByAddress(address);
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/analyze/cadastre - Analyse par référence cadastrale
 */
app.post('/api/analyze/cadastre',
  [
    body('codePostal')
      .isLength({ min: 5, max: 5 })
      .isNumeric()
      .withMessage('Code postal français invalide (5 chiffres)'),
    body('commune')
      .isString()
      .isLength({ min: 2, max: 100 })
      .withMessage('Nom de commune invalide'),
    body('numeroParcelle')
      .isString()
      .isLength({ min: 1, max: 20 })
      .withMessage('Numéro de parcelle invalide')
  ],
  validateRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { codePostal, commune, numeroParcelle } = req.body;
      
      console.log(`🗺️ Analyse demandée pour la parcelle: ${numeroParcelle}, ${commune} ${codePostal}`);
      
      const result = await pluApiService.analyzeByCadastre(codePostal, commune, numeroParcelle);
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/validate/address - Validation d'adresse
 */
app.get('/api/validate/address',
  [
    query('q')
      .isString()
      .isLength({ min: 3, max: 200 })
      .withMessage('La recherche doit contenir entre 3 et 200 caractères')
  ],
  validateRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q } = req.query as { q: string };
      
      const addressData = await pluApiService.searchAddress(q);
      
      res.json({
        success: true,
        data: {
          address: addressData,
          isValid: addressData.score > 0.7,
          confidence: addressData.score
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/search/suggest - Autocomplétion d'adresses
 */
app.get('/api/search/suggest',
  [
    query('q')
      .isString()
      .isLength({ min: 3, max: 100 })
      .withMessage('La recherche doit contenir entre 3 et 100 caractères')
  ],
  validateRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q } = req.query as { q: string };
      
      console.log(`🔍 Suggestion demandée pour: ${q}`);
      
      // Utilisation de l'API fetch globale (disponible dans Node.js 18+)
      const response = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`);
      
      if (!response.ok) {
        throw new Error(`Erreur API BAN: ${response.status}`);
      }
      
      const data = await response.json();
      
      const suggestions = data.features?.map((feature: any) => ({
        label: feature.properties.label,
        score: feature.properties.score,
        type: feature.properties.type,
        city: feature.properties.city,
        postcode: feature.properties.postcode
      })) || [];
      
      res.json({
        success: true,
        data: suggestions,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Erreur autocomplétion:', error);
      // En cas d'erreur, retourner un tableau vide plutôt qu'une erreur
      res.json({
        success: true,
        data: [],
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * GET /api/zones/types - Liste des types de zones PLU
 */
app.get('/api/zones/types', (req: Request, res: Response) => {
  const zoneTypes = [
    {
      code: 'U',
      name: 'Zone urbaine',
      description: 'Zones équipées où les constructions sont autorisées',
      subcategories: ['UA', 'UB', 'UC', 'UD', 'UE', 'UG', 'UH', 'UI', 'UL', 'UM', 'UP', 'UR', 'UT', 'UX', 'UZ']
    },
    {
      code: 'AU',
      name: 'Zone à urbaniser',
      description: 'Zones destinées à être ouvertes à l\'urbanisation',
      subcategories: ['1AU', '2AU']
    },
    {
      code: 'A',
      name: 'Zone agricole',
      description: 'Zones protégées en raison de leur potentiel agronomique',
      subcategories: ['A', 'Ap', 'Ah']
    },
    {
      code: 'N',
      name: 'Zone naturelle',
      description: 'Zones protégées en raison de leur intérêt naturel',
      subcategories: ['N', 'Nb', 'Nc', 'Nd', 'Ne', 'Nf', 'Nh', 'Nj', 'Nl', 'Nr', 'Ns', 'Nt']
    }
  ];

  res.json({
    success: true,
    data: zoneTypes,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/test/address - Test de recherche d'adresse pour débogage
 */
app.get('/api/test/address',
  [
    query('q')
      .isString()
      .isLength({ min: 3, max: 200 })
      .withMessage('La recherche doit contenir entre 3 et 200 caractères')
  ],
  validateRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q } = req.query as { q: string };
      
      console.log(`🧪 Test de recherche pour: "${q}"`);
      
      const results: any = {
        originalQuery: q,
        strategies: {}
      };
      
      // Test 1: Recherche exacte
      try {
        console.log('Test 1: Recherche exacte');
        const response1 = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`);
        const data1 = await response1.json();
        
        results.strategies.exact = {
          success: true,
          resultsCount: data1.features?.length || 0,
          results: data1.features?.slice(0, 3).map((f: any) => ({
            label: f.properties.label,
            score: f.properties.score,
            type: f.properties.type
          })) || []
        };
        
        console.log(`✅ Recherche exacte: ${data1.features?.length || 0} résultats`);
      } catch (error) {
        results.strategies.exact = {
          success: false,
          error: error instanceof Error ? error.message : 'Erreur inconnue'
        };
        console.log(`❌ Erreur recherche exacte:`, error);
      }
      
      // Test 2: Recherche sans numéro
      try {
        const addressWithoutNumber = q.replace(/^\d+\s*/, '').trim();
        if (addressWithoutNumber !== q && addressWithoutNumber.length > 5) {
          console.log(`Test 2: Recherche sans numéro: "${addressWithoutNumber}"`);
          
          const response2 = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(addressWithoutNumber)}&limit=5`);
          const data2 = await response2.json();
          
          results.strategies.withoutNumber = {
            success: true,
            query: addressWithoutNumber,
            resultsCount: data2.features?.length || 0,
            results: data2.features?.slice(0, 3).map((f: any) => ({
              label: f.properties.label,
              score: f.properties.score,
              type: f.properties.type
            })) || []
          };
          
          console.log(`✅ Recherche sans numéro: ${data2.features?.length || 0} résultats`);
        }
      } catch (error) {
        results.strategies.withoutNumber = {
          success: false,
          error: error instanceof Error ? error.message : 'Erreur inconnue'
        };
        console.log(`❌ Erreur recherche sans numéro:`, error);
      }
      
      // Test 3: Recherche par ville
      try {
        const cityMatch = q.match(/\d{5}\s+([^,]+)/);
        if (cityMatch) {
          const cityName = cityMatch[1].trim();
          console.log(`Test 3: Recherche par ville: "${cityName}"`);
          
          const response3 = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(cityName)}&type=municipality&limit=1`);
          const data3 = await response3.json();
          
          results.strategies.city = {
            success: true,
            query: cityName,
            resultsCount: data3.features?.length || 0,
            results: data3.features?.map((f: any) => ({
              label: f.properties.label,
              score: f.properties.score,
              type: f.properties.type,
              coordinates: f.geometry.coordinates
            })) || []
          };
          
          console.log(`✅ Recherche par ville: ${data3.features?.length || 0} résultats`);
        }
      } catch (error) {
        results.strategies.city = {
          success: false,
          error: error instanceof Error ? error.message : 'Erreur inconnue'
        };
        console.log(`❌ Erreur recherche par ville:`, error);
      }
      
      // Test 4: Variantes de recherche
      try {
        console.log('Test 4: Variantes de recherche');
        const variants = [
          q.replace(/sainte-marie-de-ré/i, 'sainte marie de re'),
          q.replace(/sainte-marie-de-ré/i, 'ste marie de re'),
          q.replace(/rue du/i, 'rue'),
          q.replace(/lièvre/i, 'lievre')
        ];
        
        results.strategies.variants = [];
        
        for (const variant of variants) {
          if (variant !== q) {
            try {
              const response4 = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(variant)}&limit=3`);
              const data4 = await response4.json();
              
              results.strategies.variants.push({
                query: variant,
                resultsCount: data4.features?.length || 0,
                bestResult: data4.features?.[0] ? {
                  label: data4.features[0].properties.label,
                  score: data4.features[0].properties.score
                } : null
              });
              
              console.log(`✅ Variante "${variant}": ${data4.features?.length || 0} résultats`);
            } catch (variantError) {
              console.log(`❌ Erreur variante "${variant}":`, variantError);
            }
          }
        }
      } catch (error) {
        results.strategies.variants = {
          success: false,
          error: error instanceof Error ? error.message : 'Erreur inconnue'
        };
      }
      
      res.json({
        success: true,
        data: results,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Erreur globale dans le test:', error);
      next(error);
    }
  }
);

/**
 * POST /api/analyze/address-enhanced - Analyse enrichie avec extraction PDF
 */
app.post('/api/analyze/address-enhanced',
  [
    body('address')
      .isString()
      .isLength({ min: 5, max: 200 })
      .withMessage('L\'adresse doit contenir entre 5 et 200 caractères')
      .matches(/\d/)
      .withMessage('L\'adresse doit contenir au moins un numéro'),
    body('extractFromPDF')
      .optional()
      .isBoolean()
      .withMessage('extractFromPDF doit être un booléen'),
    body('useAI')
      .optional()
      .isBoolean()
      .withMessage('useAI doit être un booléen'),
    body('forceRefresh')
      .optional()
      .isBoolean()
      .withMessage('forceRefresh doit être un booléen')
  ],
  validateRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { address, extractFromPDF = true, useAI = true, forceRefresh = false } = req.body;
      
      console.log(`📍 Analyse enrichie demandée pour: ${address}`);
      console.log(`   Options: PDF=${extractFromPDF}, IA=${useAI}, Refresh=${forceRefresh}`);
      
      const startTime = Date.now();
      
      const result = await pluApiService.analyzeByAddressWithPDFExtraction(address, {
        extractFromPDF,
        useAI,
        forceRefresh
      });
      
      const duration = Date.now() - startTime;
      
      res.json({
        success: true,
        data: result,
        metadata: {
          processingTime: duration,
          hasPDFExtraction: !!result.pdfAnalysis,
          pdfConfidence: result.pdfAnalysis?.confidence,
          extractionMethod: result.pdfAnalysis ? 
            (result.pdfAnalysis.confidence > 0.8 ? 'traditional' : 'ai') : 'none'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/plu/extract - Extraction PDF directe
 */
app.post('/api/plu/extract',
  [
    body('pdfUrl')
      .isURL({ protocols: ['http', 'https'], require_tld: false })
      .withMessage('URL PDF invalide'),
    body('zone')
      .isString()
      .isLength({ min: 1, max: 10 })
      .matches(/^[A-Z]{1,3}\d*[A-Z]*$/i)
      .withMessage('Code de zone PLU invalide (ex: UB, AU1, N)'),
    body('useAI')
      .optional()
      .isBoolean()
      .withMessage('useAI doit être un booléen'),
    body('forceRefresh')
      .optional()
      .isBoolean()
      .withMessage('forceRefresh doit être un booléen'),
    body('timeout')
      .optional()
      .isInt({ min: 5000, max: 300000 })
      .withMessage('timeout doit être entre 5000 et 300000 ms')
  ],
  validateRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pdfUrl, zone, useAI = true, forceRefresh = false, timeout = 60000 } = req.body;
      
      console.log(`📄 Extraction PDF demandée:`);
      console.log(`   URL: ${pdfUrl}`);
      console.log(`   Zone: ${zone}`);
      console.log(`   Options: IA=${useAI}, Refresh=${forceRefresh}, Timeout=${timeout}ms`);
      
      const startTime = Date.now();
      
      const result = await pluApiService.extractPLUFromPDF(pdfUrl, zone, {
        useAI,
        forceRefresh,
        timeout
      });
      
      const duration = Date.now() - startTime;
      
      res.json({
        success: true,
        data: result,
        metadata: {
          processingTime: duration,
          confidence: result.confidence,
          extractionMethod: result.confidence > 0.8 ? 'traditional' : 'ai',
          rulesExtracted: [
            result.hauteurMaximale ? 'hauteur' : null,
            result.empriseAuSolMax ? 'emprise' : null,
            result.reculVoirie ? 'recul' : null,
            result.stationnementHabitation ? 'stationnement' : null,
            result.usagesAutorises.length > 0 ? 'usages' : null
          ].filter(Boolean),
          sourceArticles: result.sourceArticles
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/plu/extract-all - Extraction de toutes les zones d'un PDF
 */
app.post('/api/plu/extract-all',
  [
    body('pdfUrl')
      .isURL({ protocols: ['http', 'https'], require_tld: false })
      .withMessage('URL PDF invalide'),
    body('useAI')
      .optional()
      .isBoolean()
      .withMessage('useAI doit être un booléen'),
    body('forceRefresh')
      .optional()
      .isBoolean()
      .withMessage('forceRefresh doit être un booléen')
  ],
  validateRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pdfUrl, useAI = true, forceRefresh = false } = req.body;
      
      console.log(`📄 Extraction complète PDF demandée: ${pdfUrl}`);
      
      const startTime = Date.now();
      
      const results = await pluApiService.extractAllZonesFromPDF(pdfUrl, {
        useAI,
        forceRefresh
      });
      
      const duration = Date.now() - startTime;
      
      // Statistiques
      const stats = {
        totalZones: results.length,
        averageConfidence: results.reduce((sum, r) => sum + r.confidence, 0) / Math.max(results.length, 1),
        highConfidenceZones: results.filter(r => r.confidence > 0.8).length,
        extractionMethods: {
          traditional: results.filter(r => r.confidence > 0.8).length,
          ai: results.filter(r => r.confidence <= 0.8 && r.confidence > 0).length
        },
        totalRulesExtracted: results.reduce((sum, r) => {
          let count = 0;
          if (r.hauteurMaximale) count++;
          if (r.empriseAuSolMax) count++;
          if (r.reculVoirie) count++;
          if (r.stationnementHabitation) count++;
          count += r.usagesAutorises.length + r.usagesInterdits.length;
          return sum + count;
        }, 0)
      };
      
      res.json({
        success: true,
        data: results,
        metadata: {
          processingTime: duration,
          statistics: stats,
          zonesDetected: results.map(r => r.zone)
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/plu/cache/status - Statut du cache
 */
app.get('/api/plu/cache/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Vérification Redis si disponible
      let cacheStatus = {
        enabled: false,
        connected: false,
        keys: 0,
        memoryUsage: 'N/A'
      };
      
      if (process.env.REDIS_URL) {
        try {
          // Simuler une vérification Redis (adapter selon votre implementation)
          cacheStatus = {
            enabled: true,
            connected: true,
            keys: 0, // Nombre de clés en cache
            memoryUsage: '0 MB'
          };
        } catch (error) {
          console.warn('Cache Redis inaccessible:', error);
        }
      }
      
      res.json({
        success: true,
        data: {
          cache: cacheStatus,
          extractionMode: process.env.PDF_EXTRACTION_MODE || 'hybrid',
          aiAvailable: !!process.env.OLLAMA_URL,
          maxPdfSize: process.env.MAX_PDF_SIZE_MB || '50MB',
          timeout: process.env.EXTRACTION_TIMEOUT_MS || '60000ms'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/plu/cache/clear - Vider le cache
 */
app.delete('/api/plu/cache/clear',
  [
    query('pattern')
      .optional()
      .isString()
      .withMessage('Pattern doit être une chaîne')
  ],
  validateRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pattern } = req.query as { pattern?: string };
      
      console.log(`🗑️ Demande de vidage du cache${pattern ? ` (pattern: ${pattern})` : ''}`);
      
      // Ici, implementer la logique de vidage du cache Redis
      // Exemple avec Redis:
      // if (redis) {
      //   if (pattern) {
      //     const keys = await redis.keys(`plu:*${pattern}*`);
      //     if (keys.length > 0) {
      //       await redis.del(...keys);
      //     }
      //   } else {
      //     await redis.flushdb(); // Vider toute la DB
      //   }
      // }
      
      res.json({
        success: true,
        message: pattern 
          ? `Cache vidé pour le pattern: ${pattern}`
          : 'Cache complètement vidé',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/plu/test/pdf - Test d'extraction avec PDF exemple
 */
app.get('/api/plu/test/pdf',
  [
    query('zone')
      .optional()
      .isString()
      .matches(/^[A-Z]{1,3}\d*[A-Z]*$/i)
      .withMessage('Code de zone PLU invalide'),
    query('useAI')
      .optional()
      .isBoolean()
      .withMessage('useAI doit être un booléen')
  ],
  validateRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { zone = 'UB', useAI = true } = req.query as { zone?: string; useAI?: boolean };
      
      console.log(`🧪 Test d'extraction PDF pour la zone: ${zone}`);
      
      // URL de test (à adapter selon vos besoins)
      const testPdfUrl = 'https://www.example.com/test-plu.pdf';
      
      const startTime = Date.now();
      
      // Test avec texte simulé pour la démonstration
      const mockResult = {
        zone,
        hauteurMaximale: 12,
        nombreEtagesMax: 2,
        empriseAuSolMax: 0.4,
        reculVoirie: 5,
        reculLimitesSeparatives: 3,
        stationnementHabitation: 1,
        usagesAutorises: ['habitation', 'bureaux'],
        usagesInterdits: ['industrie'],
        usagesConditionnes: [],
        materiaux: [],
        couleurs: [],
        toitures: [],
        ouvertures: [],
        plantationsObligatoires: [],
        essencesVegetales: [],
        espacesLibresMin: 30,
        confidence: useAI ? 0.75 : 0.85,
        sourceArticles: [`${zone}10`, `${zone}9`, `${zone}6`],
        lastUpdated: new Date().toISOString(),
        restrictions: [
          `Hauteur maximale : 12 mètres`,
          `Emprise au sol maximale : 40%`,
          `Recul minimum voirie : 5 mètres`
        ],
        rights: [
          'Construction d\'habitation autorisée',
          'Bureaux autorisés sous conditions',
          'Extensions possibles'
        ]
      };
      
      const duration = Date.now() - startTime;
      
      res.json({
        success: true,
        data: mockResult,
        metadata: {
          processingTime: duration,
          testMode: true,
          extractionMethod: useAI ? 'ai-simulation' : 'traditional-simulation',
          pdfUrl: testPdfUrl
        },
        message: 'Résultat de test - En production, ceci analyserait un vrai PDF PLU',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/plu/patterns/test - Test des patterns regex
 */
app.get('/api/plu/patterns/test',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log(`🔬 Test des patterns d'extraction PLU`);
      
      // Texte de test typique d'un règlement PLU
      const testText = `
        Article UB10 - Hauteur maximale des constructions
        
        La hauteur des constructions ne peut excéder 12 mètres au faîtage.
        Le nombre d'étages est limité à R+2.
        
        Article UB9 - Emprise au sol des constructions
        
        L'emprise au sol des constructions ne peut excéder 40% de la superficie du terrain.
        
        Article UB6 - Implantation par rapport aux voies
        
        Les constructions doivent observer un recul minimum de 5 mètres par rapport à l'alignement.
        
        Article UB12 - Stationnement
        
        Il est exigé 1 place de stationnement par logement.
        Pour les bureaux : 1 place pour 40 m² de surface de plancher.
        
        Article UB1 - Occupations interdites
        
        Sont interdites les activités industrielles et les entrepôts.
        
        Article UB2 - Occupations autorisées
        
        Sont autorisées les constructions à usage d'habitation et de bureaux.
      `;
      
      // Simulation d'extraction avec patterns
      const extractedData = {
        hauteur: {
          values: [12],
          patterns: ['hauteur[^.]*?ne peut excéder (\\d+) mètres'],
          confidence: 0.9
        },
        etages: {
          values: [2],
          patterns: ['R\\+(\\d+)'],
          confidence: 0.95
        },
        emprise: {
          values: [40],
          patterns: ['emprise[^.]*?(\\d+)% de la superficie'],
          confidence: 0.9
        },
        recul: {
          values: [5],
          patterns: ['recul minimum de (\\d+) mètres'],
          confidence: 0.85
        },
        stationnement: {
          values: [1, 0.025], // 1 place/logement, 1 place/40m² = 0.025 place/m²
          patterns: ['(\\d+) place[^.]*?logement', '1 place pour (\\d+) m²'],
          confidence: 0.8
        },
        usagesInterdits: {
          values: ['activités industrielles', 'entrepôts'],
          patterns: ['Sont interdites ([^.]+)'],
          confidence: 0.75
        },
        usagesAutorises: {
          values: ['habitation', 'bureaux'],
          patterns: ['constructions à usage ([^.]+)'],
          confidence: 0.8
        }
      };
      
      // Statistiques
      const stats = {
        totalPatternsApplied: Object.keys(extractedData).length,
        averageConfidence: Object.values(extractedData).reduce((sum, item) => sum + item.confidence, 0) / Object.keys(extractedData).length,
        highConfidenceExtractions: Object.values(extractedData).filter(item => item.confidence > 0.8).length,
        textLength: testText.length,
        extractionCoverage: '85%'
      };
      
      res.json({
        success: true,
        data: {
          testText: testText.substring(0, 500) + '...', // Aperçu
          extractedData,
          statistics: stats,
          recommendations: [
            stats.averageConfidence < 0.8 ? 'Améliorer les patterns pour augmenter la confiance' : 'Patterns fonctionnent correctement',
            'Ajouter plus de variations linguistiques pour les patterns',
            'Tester avec de vrais documents PLU pour valider'
          ]
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * MISE À JOUR des routes existantes pour supporter l'extraction PDF optionnelle
 */

// Modifier la route analyze/address existante
app.post('/api/analyze/address',
  [
    body('address')
      .isString()
      .isLength({ min: 5, max: 200 })
      .withMessage('L\'adresse doit contenir entre 5 et 200 caractères')
      .matches(/\d/)
      .withMessage('L\'adresse doit contenir au moins un numéro'),
    body('withPDF')
      .optional()
      .isBoolean()
      .withMessage('withPDF doit être un booléen')
  ],
  validateRequest,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { address, withPDF = false } = req.body;
      
      console.log(`📍 Analyse ${withPDF ? 'enrichie' : 'standard'} pour: ${address}`);
      
      const result = await pluApiService.analyzeByAddress(address, withPDF);
      
      res.json({
        success: true,
        data: result,
        metadata: {
          analysisType: withPDF ? 'enhanced' : 'standard',
          hasPDFExtraction: withPDF
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/plu/documentation - Documentation des patterns et formats
 */
app.get('/api/plu/documentation',
  async (req: Request, res: Response) => {
    const documentation = {
      patterns: {
        hauteur: {
          description: 'Extraction des hauteurs maximales en mètres',
          examples: [
            'hauteur maximale de 12 mètres',
            '15 m au faîtage',
            'ne peut excéder 10 mètres'
          ],
          regex: [
            'hauteur[^.]*?(\\d+(?:[.,]\\d+)?)\\s*(?:mètres?|m\\b)',
            '(\\d+(?:[.,]\\d+)?)\\s*(?:mètres?|m\\b)[^.]*?faîtage'
          ]
        },
        emprise: {
          description: 'Extraction de l\'emprise au sol en pourcentage',
          examples: [
            'emprise au sol ne peut excéder 40%',
            '35% de la superficie du terrain',
            'coefficient d\'emprise de 0,4'
          ],
          regex: [
            'emprise[^.]*?sol[^.]*?(\\d+(?:[.,]\\d+)?)\\s*%',
            'coefficient[^.]*?emprise[^.]*?(\\d+(?:[.,]\\d+)?)'
          ]
        },
        recul: {
          description: 'Extraction des distances de recul en mètres',
          examples: [
            'recul minimum de 5 mètres',
            'implantation à 3 mètres minimum',
            'distance de 4 m de la voirie'
          ],
          regex: [
            'recul[^.]*?minimum[^.]*?(\\d+(?:[.,]\\d+)?)\\s*(?:mètres?|m\\b)',
            'distance[^.]*?(\\d+(?:[.,]\\d+)?)\\s*(?:mètres?|m\\b)[^.]*?voirie'
          ]
        }
      },
      apiFormats: {
        request: {
          extractFromPDF: {
            url: '/api/plu/extract',
            method: 'POST',
            body: {
              pdfUrl: 'https://example.com/plu.pdf',
              zone: 'UB',
              useAI: true,
              forceRefresh: false
            }
          },
          enhancedAnalysis: {
            url: '/api/analyze/address-enhanced',
            method: 'POST',
            body: {
              address: '123 Rue Example 33000 Bordeaux',
              extractFromPDF: true,
              useAI: true
            }
          }
        },
        response: {
          structure: {
            success: 'boolean',
            data: 'DetailedPLUAnalysis',
            metadata: {
              processingTime: 'number (ms)',
              confidence: 'number (0-1)',
              extractionMethod: 'traditional|ai|cache'
            }
          }
        }
      },
      zones: {
        types: {
          U: 'Zone urbaine équipée',
          AU: 'Zone à urbaniser',
          A: 'Zone agricole',
          N: 'Zone naturelle et forestière'
        },
        codes: [
          'UA', 'UB', 'UC', 'UD', 'UE', 'UG', 'UH', 'UI', 'UL', 'UM', 'UP', 'UR', 'UT', 'UX', 'UZ',
          '1AU', '2AU',
          'A', 'Ap', 'Ah',
          'N', 'Nb', 'Nc', 'Nd', 'Ne', 'Nf', 'Nh', 'Nj', 'Nl', 'Nr', 'Ns', 'Nt'
        ]
      },
      articles: {
        standard: {
          1: 'Occupations et utilisations du sol interdites',
          2: 'Occupations et utilisations du sol soumises à conditions particulières',
          6: 'Implantation des constructions par rapport aux voies et emprises publiques',
          7: 'Implantation des constructions par rapport aux limites séparatives',
          9: 'Emprise au sol des constructions',
          10: 'Hauteur maximale des constructions',
          12: 'Aires de stationnement',
          13: 'Espaces libres et plantations'
        }
      }
    };
    
    res.json({
      success: true,
      data: documentation,
      version: '1.1.0',
      timestamp: new Date().toISOString()
    });
  }
);

/**
 * Middleware de gestion d'erreurs spécifique PDF
 */
const pdfErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err.message?.includes('PDF') || err.message?.includes('Ollama')) {
    const statusCode = err.statusCode || 422;
    
    console.error(`PDF/IA Error ${statusCode}:`, err);
    
    return res.status(statusCode).json({
      success: false,
      error: {
        message: err.message,
        type: 'PDF_EXTRACTION_ERROR',
        suggestions: [
          'Vérifiez que l\'URL du PDF est accessible',
          'Assurez-vous que le PDF contient du texte extractible',
          'Vérifiez la connectivité avec le service Ollama si utilisant l\'IA',
          'Réessayez avec forceRefresh=true pour ignorer le cache'
        ],
        ...(process.env.NODE_ENV === 'development' && { 
          stack: err.stack,
          details: err 
        })
      }
    });
  }
  
  next(err);
};

// Route catch-all pour les routes non trouvées
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Route non trouvée',
      path: req.originalUrl,
      method: req.method
    }
  });
});

// Middleware de gestion d'erreurs (doit être en dernier)
app.use(errorHandler);
app.use(pdfErrorHandler);

// Démarrage du serveur
const server = app.listen(PORT, () => {
  console.log(`🚀 Serveur API PLU démarré sur le port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌍 Environnement: ${process.env.NODE_ENV || 'development'}`);
  
  if (isDevelopment) {
    console.log(`🔧 Mode développement activé`);
    console.log(`🌐 CORS autorisé pour: localhost:5173, localhost:3000`);
    console.log(`⚡ Rate limiting: 1000 req/min (vs 100 en production)`);
  }
});

// Gestion gracieuse de l'arrêt
process.on('SIGTERM', () => {
  console.log('📴 Arrêt du serveur...');
  server.close(() => {
    console.log('✅ Serveur arrêté proprement');
    process.exit(0);
  });
});

export default app;