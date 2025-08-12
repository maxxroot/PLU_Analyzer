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