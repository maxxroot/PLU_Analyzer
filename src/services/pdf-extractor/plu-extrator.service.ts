// src/services/pdf-extractor/plu-extractor.service.ts
import * as pdfParse from 'pdf-parse';
import * as crypto from 'crypto';
import { Redis } from 'redis';

// Types pour l'extraction PLU
export interface DetailedPLUAnalysis {
  zone: string;
  
  // Hauteurs et volumes
  hauteurMaximale: number | null;
  nombreEtagesMax: number | null;
  hauteurAuFaitage: number | null;
  hauteurAcrotere: number | null;
  
  // Emprises et coefficients  
  empriseAuSolMax: number | null;
  coefficientOccupationSol: number | null;
  coefficientEspacesVerts: number | null;
  
  // Reculs et implantations
  reculVoirie: number | null;
  reculLimitesSeparatives: number | null;
  implantationSurLimite: boolean | null;
  
  // Stationnement
  stationnementHabitation: number | null;
  stationnementBureaux: number | null;
  stationnementCommerce: number | null;
  
  // Usages autorisés/interdits
  usagesAutorises: string[];
  usagesInterdits: string[];
  usagesConditionnes: string[];
  
  // Prescriptions architecturales
  materiaux: string[];
  couleurs: string[];
  toitures: string[];
  ouvertures: string[];
  
  // Espaces verts et paysager
  plantationsObligatoires: string[];
  essencesVegetales: string[];
  espacesLibresMin: number | null;
  
  // Métadonnées
  confidence: number;
  sourceArticles: string[];
  lastUpdated: string;
  
  // Pour compatibilité avec l'API existante
  restrictions: string[];
  rights: string[];
}

export interface ExtractionOptions {
  forceRefresh?: boolean;
  useAI?: boolean;
  timeout?: number;
}

export interface ExtractionMetrics {
  method: 'traditional' | 'ai' | 'cache';
  duration: number;
  confidence: number;
  rulesExtracted: number;
  errors: string[];
  pdfSize: number;
  cacheHit: boolean;
}

/**
 * Service principal d'extraction des règles PLU depuis les PDFs
 */
export class PLUExtractorService {
  private redis: Redis | null = null;
  private ollamaUrl: string;

  constructor() {
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    this.initializeRedis();
  }

  private async initializeRedis() {
    try {
      if (process.env.REDIS_URL) {
        this.redis = new Redis(process.env.REDIS_URL);
        console.log('✅ Redis connecté pour le cache PLU');
      }
    } catch (error) {
      console.warn('⚠️ Redis non disponible, cache désactivé:', error);
      this.redis = null;
    }
  }

  /**
   * Point d'entrée principal pour l'extraction
   */
  async extractFromPDF(pdfUrl: string, zone: string, options: ExtractionOptions = {}): Promise<DetailedPLUAnalysis> {
    const startTime = Date.now();
    const metrics: ExtractionMetrics = {
      method: 'traditional',
      duration: 0,
      confidence: 0,
      rulesExtracted: 0,
      errors: [],
      pdfSize: 0,
      cacheHit: false
    };

    try {
      console.log(`🚀 Extraction PLU démarrée: ${zone} depuis ${pdfUrl}`);

      // 1. Vérifier le cache en premier
      if (!options.forceRefresh && this.redis) {
        const cached = await this.getCachedAnalysis(pdfUrl, zone);
        if (cached) {
          metrics.method = 'cache';
          metrics.duration = Date.now() - startTime;
          metrics.cacheHit = true;
          metrics.confidence = cached.confidence;
          console.log(`✅ Analyse récupérée du cache (${metrics.duration}ms)`);
          return cached;
        }
      }

      // 2. Télécharger et analyser le PDF
      const pdfBuffer = await this.downloadPDF(pdfUrl);
      metrics.pdfSize = pdfBuffer.length;

      // 3. Extraire le texte du PDF
      const extractedText = await this.extractTextFromPDF(pdfBuffer);
      
      // 4. Trouver la section de la zone
      const zoneText = this.findZoneSection(extractedText, zone);
      
      if (!zoneText || zoneText.length < 100) {
        throw new Error(`Section de zone ${zone} non trouvée ou trop courte dans le PDF`);
      }

      // 5. Extraction traditionnelle (priorité)
      let analysis: DetailedPLUAnalysis;
      
      try {
        analysis = await this.extractWithTraditionalMethod(zoneText, zone);
        metrics.method = 'traditional';
        console.log(`✅ Extraction traditionnelle réussie pour ${zone}`);
      } catch (traditionalError) {
        console.warn(`⚠️ Extraction traditionnelle échouée, tentative IA:`, traditionalError);
        metrics.errors.push(`Traditional: ${traditionalError}`);
        
        // 6. Fallback IA si extraction traditionnelle échoue
        if (options.useAI !== false) {
          try {
            analysis = await this.extractWithAI(zoneText, zone, options.timeout);
            metrics.method = 'ai';
            console.log(`✅ Extraction IA réussie pour ${zone}`);
          } catch (aiError) {
            metrics.errors.push(`AI: ${aiError}`);
            throw new Error(`Extraction échouée: traditional et IA ont échoué. Détails: ${metrics.errors.join(', ')}`);
          }
        } else {
          throw traditionalError;
        }
      }

      // 7. Métriques finales
      metrics.duration = Date.now() - startTime;
      metrics.confidence = analysis.confidence;
      metrics.rulesExtracted = this.countExtractedRules(analysis);

      // 8. Mise en cache
      if (this.redis && analysis.confidence > 0.6) {
        await this.cacheAnalysis(pdfUrl, zone, analysis);
      }

      console.log(`✅ Extraction terminée pour ${zone}:`, {
        method: metrics.method,
        duration: `${metrics.duration}ms`,
        confidence: `${Math.round(metrics.confidence * 100)}%`,
        rules: metrics.rulesExtracted
      });

      return analysis;

    } catch (error) {
      metrics.duration = Date.now() - startTime;
      metrics.errors.push(error instanceof Error ? error.message : 'Erreur inconnue');
      
      console.error(`❌ Extraction échouée pour ${zone}:`, {
        duration: `${metrics.duration}ms`,
        errors: metrics.errors
      });
      
      throw new Error(`Impossible d'extraire les règles PLU: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  /**
   * Télécharge un PDF depuis une URL
   */
  private async downloadPDF(url: string): Promise<Buffer> {
    console.log(`📥 Téléchargement du PDF: ${url}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'PLU-Analyzer/1.0 (compatible; automated PLU analysis)',
          'Accept': 'application/pdf,*/*'
        }
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Erreur HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('pdf')) {
        console.warn(`⚠️ Type de contenu inattendu: ${contentType}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      console.log(`✅ PDF téléchargé: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
      
      return buffer;
    } catch (error) {
      clearTimeout(timeout);
      throw new Error(`Impossible de télécharger le PDF: ${error instanceof Error ? error.message : 'Erreur réseau'}`);
    }
  }

  /**
   * Extrait le texte d'un PDF en utilisant pdf-parse
   */
  private async extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
    try {
      console.log(`📄 Extraction du texte PDF...`);
      
      const data = await pdfParse(pdfBuffer, {
        max: 0, // Pas de limite de pages
        version: 'default'
      });

      const text = data.text;
      console.log(`✅ Texte extrait: ${text.length} caractères, ${data.numpages} pages`);
      
      if (text.length < 500) {
        throw new Error('PDF semble vide ou illisible (moins de 500 caractères extraits)');
      }

      return this.normalizeText(text);
    } catch (error) {
      console.error(`❌ Erreur extraction PDF:`, error);
      throw new Error(`Impossible d'extraire le texte du PDF: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  /**
   * Normalise et nettoie le texte extrait
   */
  private normalizeText(text: string): string {
    return text
      // Normalisation des espaces
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      
      // Normalisation des caractères
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'")
      .replace(/[–—]/g, '-')
      
      // Normalisation des chiffres
      .replace(/(\d),(\d)/g, '$1.$2') // Virgules décimales vers points
      
      // Suppression des caractères parasites
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      
      .trim();
  }

  /**
   * Trouve la section correspondant à une zone spécifique
   */
  private findZoneSection(text: string, zone: string): string {
    console.log(`🔍 Recherche de la section pour la zone: ${zone}`);

    // Patterns de détection des zones
    const zonePatterns = [
      // "ZONE UB - Zone urbaine mixte"
      new RegExp(`ZONE\\s+${zone}\\s*[-–—]([\\s\\S]*?)(?=ZONE\\s+(?!${zone})|$)`, 'i'),
      
      // "Article UB1", "Article UB2", etc.
      new RegExp(`Article\\s+${zone}\\d+([\\s\\S]*?)(?=Article\\s+(?!${zone})|ZONE\\s+|$)`, 'gi'),
      
      // Section avec titre de zone
      new RegExp(`${zone}\\s*[-–—]\\s*[^\\n]*([\\s\\S]*?)(?=\\n\\s*[A-Z]{1,3}\\d*\\s*[-–—]|$)`, 'i')
    ];

    for (const pattern of zonePatterns) {
      const matches = text.match(pattern);
      if (matches && matches[0].length > 200) {
        console.log(`✅ Section trouvée avec pattern: ${pattern.source} (${matches[0].length} caractères)`);
        return matches[0];
      }
    }

    // Fallback: chercher tous les articles de la zone
    const articlePattern = new RegExp(`Article\\s+${zone}\\d*[\\s\\S]*?(?=Article\\s+(?!${zone})|$)`, 'gi');
    const articles = text.match(articlePattern) || [];
    
    if (articles.length > 0) {
      const combined = articles.join('\n\n');
      console.log(`✅ ${articles.length} articles trouvés pour ${zone} (${combined.length} caractères)`);
      return combined;
    }

    console.warn(`⚠️ Aucune section trouvée pour la zone ${zone}`);
    return '';
  }

  /**
   * Extraction traditionnelle avec patterns regex
   */
  private async extractWithTraditionalMethod(text: string, zone: string): Promise<DetailedPLUAnalysis> {
    console.log(`🔧 Extraction traditionnelle pour ${zone}...`);

    const analysis: DetailedPLUAnalysis = {
      zone,
      hauteurMaximale: null,
      nombreEtagesMax: null,
      hauteurAuFaitage: null,
      hauteurAcrotere: null,
      empriseAuSolMax: null,
      coefficientOccupationSol: null,
      coefficientEspacesVerts: null,
      reculVoirie: null,
      reculLimitesSeparatives: null,
      implantationSurLimite: null,
      stationnementHabitation: null,
      stationnementBureaux: null,
      stationnementCommerce: null,
      usagesAutorises: [],
      usagesInterdits: [],
      usagesConditionnes: [],
      materiaux: [],
      couleurs: [],
      toitures: [],
      ouvertures: [],
      plantationsObligatoires: [],
      essencesVegetales: [],
      espacesLibresMin: null,
      confidence: 0,
      sourceArticles: [],
      lastUpdated: new Date().toISOString(),
      restrictions: [],
      rights: []
    };

    // Extraction des hauteurs
    analysis.hauteurMaximale = this.extractNumericValue(text, [
      /hauteur[^.]*?(\d+(?:\.\d+)?)\s*(mètres?|m\b)/gi,
      /(\d+(?:\.\d+)?)\s*m[^a-z].*?(?:faîtage|maximum|hauteur)/gi
    ]);

    analysis.hauteurAuFaitage = this.extractNumericValue(text, [
      /faîtage[^.]*?(\d+(?:\.\d+)?)\s*(mètres?|m\b)/gi,
      /(\d+(?:\.\d+)?)\s*m.*?faîtage/gi
    ]);

    analysis.nombreEtagesMax = this.extractNumericValue(text, [
      /R\+(\d+)/gi,
      /(\d+)\s*étages?/gi,
      /rez.*?chaussée.*?\+.*?(\d+)/gi
    ]);

    // Extraction emprise au sol
    analysis.empriseAuSolMax = this.extractPercentage(text, [
      /emprise.*?sol[^.]*?(\d+(?:\.\d+)?)\s*%/gi,
      /emprise[^.]*?(\d+(?:\.\d+)?)\s*%/gi
    ]);

    analysis.coefficientOccupationSol = this.extractNumericValue(text, [
      /coefficient.*?occupation.*?(\d+(?:\.\d+)?)/gi,
      /COS[^.]*?(\d+(?:\.\d+)?)/gi
    ]);

    // Extraction reculs
    analysis.reculVoirie = this.extractNumericValue(text, [
      /recul[^.]*?voirie[^.]*?(\d+(?:\.\d+)?)\s*(mètres?|m\b)/gi,
      /voirie[^.]*?(\d+(?:\.\d+)?)\s*(mètres?|m\b)/gi,
      /alignement[^.]*?(\d+(?:\.\d+)?)\s*(mètres?|m\b)/gi
    ]);

    analysis.reculLimitesSeparatives = this.extractNumericValue(text, [
      /limites?\s+séparatives?[^.]*?(\d+(?:\.\d+)?)\s*(mètres?|m\b)/gi,
      /recul[^.]*?limites?[^.]*?(\d+(?:\.\d+)?)\s*(mètres?|m\b)/gi
    ]);

    // Extraction stationnement
    analysis.stationnementHabitation = this.extractNumericValue(text, [
      /(\d+(?:\.\d+)?)\s*places?[^.]*?logement/gi,
      /(\d+(?:\.\d+)?)\s*places?[^.]*?habitation/gi,
      /logement[^.]*?(\d+(?:\.\d+)?)\s*places?/gi
    ]);

    analysis.stationnementBureaux = this.extractStationnementRatio(text, [
      /(\d+(?:\.\d+)?)\s*places?[^.]*?(\d+)\s*m².*?bureau/gi,
      /bureau[^.]*?(\d+(?:\.\d+)?)\s*places?[^.]*?(\d+)\s*m²/gi
    ]);

    analysis.stationnementCommerce = this.extractStationnementRatio(text, [
      /(\d+(?:\.\d+)?)\s*places?[^.]*?(\d+)\s*m².*?commerce/gi,
      /commerce[^.]*?(\d+(?:\.\d+)?)\s*places?[^.]*?(\d+)\s*m²/gi
    ]);

    // Extraction usages
    analysis.usagesAutorises = this.extractUsages(text, 'autorise');
    analysis.usagesInterdits = this.extractUsages(text, 'interdit');
    analysis.usagesConditionnes = this.extractUsages(text, 'conditionne');

    // Extraction espaces verts
    analysis.coefficientEspacesVerts = this.extractPercentage(text, [
      /espaces?\s+verts?[^.]*?(\d+(?:\.\d+)?)\s*%/gi,
      /(\d+(?:\.\d+)?)\s*%[^.]*?espaces?\s+verts?/gi
    ]);

    analysis.espacesLibresMin = this.extractPercentage(text, [
      /espaces?\s+libres?[^.]*?(\d+(?:\.\d+)?)\s*%/gi,
      /(\d+(?:\.\d+)?)\s*%[^.]*?espaces?\s+libres?/gi
    ]);

    // Extraction articles sources
    analysis.sourceArticles = this.extractSourceArticles(text, zone);

    // Calcul de la confiance
    analysis.confidence = this.calculateTraditionalConfidence(analysis, text);

    // Conversion vers format API
    const apiFormat = this.convertToApiFormat(analysis);
    analysis.restrictions = apiFormat.restrictions;
    analysis.rights = apiFormat.rights;

    console.log(`✅ Extraction traditionnelle terminée: ${analysis.confidence.toFixed(2)} confiance`);
    return analysis;
  }

  /**
   * Extraction avec IA (Ollama) en fallback
   */
  private async extractWithAI(text: string, zone: string, timeout = 30000): Promise<DetailedPLUAnalysis> {
    console.log(`🤖 Extraction IA pour ${zone}...`);

    try {
      const prompt = this.buildAIPrompt(text, zone);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama3.2:3b', // Modèle léger
          prompt,
          stream: false,
          options: {
            temperature: 0.1, // Très peu de créativité
            top_p: 0.9,
            num_predict: 1000
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      const aiResult = this.parseAIResponse(data.response, zone);

      console.log(`✅ Extraction IA terminée: ${aiResult.confidence.toFixed(2)} confiance`);
      return aiResult;

    } catch (error) {
      console.error(`❌ Erreur extraction IA:`, error);
      throw new Error(`Extraction IA échouée: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  /**
   * Construit le prompt pour l'IA
   */
  private buildAIPrompt(text: string, zone: string): string {
    return `Tu es un expert en urbanisme français. Analyse ce texte de règlement PLU pour la zone ${zone} et extrais les informations en JSON strict.

Format de réponse attendu (JSON uniquement):
{
  "zone": "${zone}",
  "hauteurMaximale": nombre_en_metres_ou_null,
  "nombreEtagesMax": nombre_ou_null,
  "empriseAuSolMax": decimal_entre_0_et_1_ou_null,
  "reculVoirie": nombre_en_metres_ou_null,
  "reculLimitesSeparatives": nombre_en_metres_ou_null,
  "stationnementHabitation": nombre_de_places_ou_null,
  "usagesAutorises": ["liste", "des", "usages"],
  "usagesInterdits": ["liste", "des", "usages"],
  "confidence": decimal_entre_0_et_1
}

Règles importantes:
- Réponds UNIQUEMENT en JSON valide
- hauteurMaximale: cherche "hauteur", "mètres", "faîtage"
- empriseAuSolMax: cherche "emprise au sol", convertis les % en decimal (40% = 0.4)
- Pour les usages, identifie habitation, commerce, bureaux, industrie, etc.
- confidence: 0.9 si toutes les infos sont claires, 0.5 si partielles, 0.2 si très peu

Texte à analyser:
${text.substring(0, 3000)}

JSON:`;
  }

  /**
   * Parse la réponse de l'IA
   */
  private parseAIResponse(response: string, zone: string): DetailedPLUAnalysis {
    try {
      // Nettoyer la réponse pour extraire le JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Pas de JSON valide dans la réponse IA');
      }

      const aiData = JSON.parse(jsonMatch[0]);
      
      // Créer l'analyse complète avec les données IA
      const analysis: DetailedPLUAnalysis = {
        zone,
        hauteurMaximale: aiData.hauteurMaximale || null,
        nombreEtagesMax: aiData.nombreEtagesMax || null,
        hauteurAuFaitage: null,
        hauteurAcrotere: null,
        empriseAuSolMax: aiData.empriseAuSolMax || null,
        coefficientOccupationSol: null,
        coefficientEspacesVerts: null,
        reculVoirie: aiData.reculVoirie || null,
        reculLimitesSeparatives: aiData.reculLimitesSeparatives || null,
        implantationSurLimite: null,
        stationnementHabitation: aiData.stationnementHabitation || null,
        stationnementBureaux: null,
        stationnementCommerce: null,
        usagesAutorises: aiData.usagesAutorises || [],
        usagesInterdits: aiData.usagesInterdits || [],
        usagesConditionnes: [],
        materiaux: [],
        couleurs: [],
        toitures: [],
        ouvertures: [],
        plantationsObligatoires: [],
        essencesVegetales: [],
        espacesLibresMin: null,
        confidence: aiData.confidence || 0.5,
        sourceArticles: [`IA-${zone}`],
        lastUpdated: new Date().toISOString(),
        restrictions: [],
        rights: []
      };

      // Conversion vers format API
      const apiFormat = this.convertToApiFormat(analysis);
      analysis.restrictions = apiFormat.restrictions;
      analysis.rights = apiFormat.rights;

      return analysis;

    } catch (error) {
      throw new Error(`Impossible de parser la réponse IA: ${error instanceof Error ? error.message : 'JSON invalide'}`);
    }
  }

  /**
   * Extrait une valeur numérique avec plusieurs patterns
   */
  private extractNumericValue(text: string, patterns: RegExp[]): number | null {
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          const numMatch = match.match(/(\d+(?:\.\d+)?)/);
          if (numMatch) {
            const value = parseFloat(numMatch[1]);
            if (!isNaN(value) && value > 0 && value < 1000) { // Valeurs raisonnables
              return value;
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Extrait un pourcentage et le convertit en décimal
   */
  private extractPercentage(text: string, patterns: RegExp[]): number | null {
    const value = this.extractNumericValue(text, patterns);
    if (value !== null) {
      return value > 1 ? value / 100 : value; // Convertir % en décimal si nécessaire
    }
    return null;
  }

  /**
   * Extrait les ratios de stationnement (places/m²)
   */
  private extractStationnementRatio(text: string, patterns: RegExp[]): number | null {
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          const numbers = match.match(/(\d+(?:\.\d+)?)/g);
          if (numbers && numbers.length >= 2) {
            const places = parseFloat(numbers[0]);
            const surface = parseFloat(numbers[1]);
            if (!isNaN(places) && !isNaN(surface) && surface > 0) {
              return places / surface; // places par m²
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * Extrait les usages selon le type (autorisé/interdit/conditionné)
   */
  private extractUsages(text: string, type: 'autorise' | 'interdit' | 'conditionne'): string[] {
    const usages: string[] = [];
    const usageTypes = [
      'habitation', 'logement', 'bureau', 'bureaux', 'commerce', 'commerces',
      'artisanat', 'industrie', 'industriel', 'entrepôt', 'entrepôts',
      'équipement public', 'hébergement hôtelier', 'restaurant', 'hôtel'
    ];

    const sectionPatterns = {
      'autorise': [
        /autorisées?[\s\S]*?(?=interdites?|soumises?|article|$)/gi,
        /constructions?\s+autorisées?[\s\S]*?(?=interdites?|$)/gi
      ],
      'interdit': [
        /interdites?[\s\S]*?(?=autorisées?|soumises?|article|$)/gi,
        /constructions?\s+interdites?[\s\S]*?(?=autorisées?|$)/gi
      ],
      'conditionne': [
        /soumises?\s+à\s+conditions?[\s\S]*?(?=interdites?|autorisées?|article|$)/gi,
        /conditions?\s+particulières?[\s\S]*?(?=interdites?|$)/gi
      ]
    };

    const patterns = sectionPatterns[type] || [];
    
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          for (const usage of usageTypes) {
            if (new RegExp(usage, 'gi').test(match)) {
              if (!usages.includes(usage)) {
                usages.push(usage);
              }
            }
          }
        }
      }
    }

    return usages;
  }

  /**
   * Extrait les références d'articles
   */
  private extractSourceArticles(text: string, zone: string): string[] {
    const articles: string[] = [];
    const articlePattern = new RegExp(`Article\\s+(${zone}\\d*\\w*)`, 'gi');
    const matches = text.match(articlePattern);
    
    if (matches) {
      matches.forEach(match => {
        const articleMatch = match.match(/Article\s+(\w+\d*\w*)/i);
        if (articleMatch && !articles.includes(articleMatch[1])) {
          articles.push(articleMatch[1]);
        }
      });
    }

    return articles;
  }

  /**
   * Calcule la confiance pour la méthode traditionnelle
   */
  private calculateTraditionalConfidence(analysis: DetailedPLUAnalysis, text: string): number {
    let score = 0;
    let maxScore = 0;

    // Points pour les données numériques extraites
    const numericFields = [
      'hauteurMaximale', 'nombreEtagesMax', 'empriseAuSolMax',
      'reculVoirie', 'stationnementHabitation'
    ];

    numericFields.forEach(field => {
      maxScore += 0.1;
      if (analysis[field as keyof DetailedPLUAnalysis] !== null) {
        score += 0.1;
      }
    });

    // Points pour les usages
    maxScore += 0.2;
    if (analysis.usagesAutorises.length > 0 || analysis.usagesInterdits.length > 0) {
      score += 0.2;
    }

    // Points pour les articles sources
    maxScore += 0.1;
    if (analysis.sourceArticles.length > 0) {
      score += 0.1;
    }

    // Bonus pour la qualité du texte
    const qualityKeywords = ['article', 'construction', 'hauteur', 'emprise', 'zone'];
    const keywordCount = qualityKeywords.filter(keyword => 
      new RegExp(keyword, 'i').test(text)
    ).length;
    
    const qualityBonus = Math.min(keywordCount * 0.05, 0.2);
    score += qualityBonus;
    maxScore += 0.2;

    return maxScore > 0 ? Math.min(score / maxScore, 1) : 0;
  }

  /**
   * Convertit l'analyse en format compatible avec l'API existante
   */
  private convertToApiFormat(analysis: DetailedPLUAnalysis): { restrictions: string[]; rights: string[] } {
    const restrictions: string[] = [];
    const rights: string[] = [];

    // Convertir les données numériques en restrictions
    if (analysis.hauteurMaximale) {
      restrictions.push(`Hauteur maximale : ${analysis.hauteurMaximale} mètres`);
    }

    if (analysis.nombreEtagesMax) {
      restrictions.push(`Nombre d'étages maximum : R+${analysis.nombreEtagesMax}`);
    }

    if (analysis.empriseAuSolMax) {
      const percentage = analysis.empriseAuSolMax > 1 ? analysis.empriseAuSolMax : analysis.empriseAuSolMax * 100;
      restrictions.push(`Emprise au sol maximale : ${percentage}%`);
    }

    if (analysis.reculVoirie) {
      restrictions.push(`Recul minimum voirie : ${analysis.reculVoirie} mètres`);
    }

    if (analysis.reculLimitesSeparatives) {
      restrictions.push(`Recul limites séparatives : ${analysis.reculLimitesSeparatives} mètres`);
    }

    if (analysis.stationnementHabitation) {
      restrictions.push(`Stationnement : ${analysis.stationnementHabitation} place(s) par logement`);
    }

    // Convertir les usages interdits en restrictions
    analysis.usagesInterdits.forEach(usage => {
      restrictions.push(`${usage.charAt(0).toUpperCase() + usage.slice(1)} interdit`);
    });

    // Convertir les usages autorisés en droits
    analysis.usagesAutorises.forEach(usage => {
      rights.push(`${usage.charAt(0).toUpperCase() + usage.slice(1)} autorisé`);
    });

    // Ajouter des éléments par défaut si peu de données
    if (restrictions.length < 2) {
      restrictions.push('Respecter le règlement de zone en vigueur');
      restrictions.push('Déclaration préalable ou permis requis selon les travaux');
    }

    if (rights.length < 2) {
      rights.push('Constructions autorisées selon le zonage');
      rights.push('Aménagements conformes au PLU autorisés');
    }

    return { restrictions, rights };
  }

  /**
   * Compte le nombre de règles extraites
   */
  private countExtractedRules(analysis: DetailedPLUAnalysis): number {
    let count = 0;
    
    // Compter les champs numériques non-null
    const numericFields = [
      'hauteurMaximale', 'nombreEtagesMax', 'empriseAuSolMax',
      'reculVoirie', 'reculLimitesSeparatives', 'stationnementHabitation'
    ];
    
    numericFields.forEach(field => {
      if (analysis[field as keyof DetailedPLUAnalysis] !== null) {
        count++;
      }
    });

    // Compter les usages
    count += analysis.usagesAutorises.length;
    count += analysis.usagesInterdits.length;
    count += analysis.usagesConditionnes.length;

    return count;
  }

  /**
   * Gestion du cache
   */
  private getCacheKey(pdfUrl: string, zone: string): string {
    const hash = crypto.createHash('sha256').update(pdfUrl + zone).digest('hex');
    return `plu:analysis:${hash}`;
  }

  private async getCachedAnalysis(pdfUrl: string, zone: string): Promise<DetailedPLUAnalysis | null> {
    if (!this.redis) return null;

    try {
      const key = this.getCacheKey(pdfUrl, zone);
      const cached = await this.redis.get(key);
      
      if (cached) {
        console.log(`📦 Analyse trouvée dans le cache pour ${zone}`);
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn('⚠️ Erreur lecture cache:', error);
    }

    return null;
  }

  private async cacheAnalysis(pdfUrl: string, zone: string, analysis: DetailedPLUAnalysis): Promise<void> {
    if (!this.redis) return;

    try {
      const key = this.getCacheKey(pdfUrl, zone);
      const ttl = 30 * 24 * 3600; // 30 jours
      
      await this.redis.setex(key, ttl, JSON.stringify(analysis));
      console.log(`💾 Analyse mise en cache pour ${zone} (TTL: 30 jours)`);
    } catch (error) {
      console.warn('⚠️ Erreur mise en cache:', error);
    }
  }

  /**
   * Extraction de toutes les zones d'un PDF
   */
  async extractAllZones(pdfUrl: string, options: ExtractionOptions = {}): Promise<DetailedPLUAnalysis[]> {
    console.log(`🚀 Extraction complète du PDF: ${pdfUrl}`);

    try {
      // Télécharger et extraire le texte
      const pdfBuffer = await this.downloadPDF(pdfUrl);
      const extractedText = await this.extractTextFromPDF(pdfBuffer);

      // Détecter toutes les zones présentes
      const zones = this.detectAllZones(extractedText);
      console.log(`🔍 Zones détectées: ${zones.join(', ')}`);

      // Extraire chaque zone
      const results: DetailedPLUAnalysis[] = [];
      
      for (const zone of zones) {
        try {
          const analysis = await this.extractFromPDF(pdfUrl, zone, {
            ...options,
            forceRefresh: false // Utiliser le cache pour les zones suivantes
          });
          results.push(analysis);
        } catch (error) {
          console.warn(`⚠️ Erreur extraction zone ${zone}:`, error);
          // Continuer avec les autres zones
        }
      }

      console.log(`✅ Extraction complète terminée: ${results.length}/${zones.length} zones extraites`);
      return results;

    } catch (error) {
      console.error(`❌ Erreur extraction complète:`, error);
      throw new Error(`Impossible d'extraire toutes les zones: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  /**
   * Détecte automatiquement toutes les zones présentes dans un PDF
   */
  private detectAllZones(text: string): string[] {
    const zones = new Set<string>();
    
    // Patterns pour détecter les zones
    const zonePatterns = [
      /ZONE\s+([A-Z]{1,3}\d*[A-Z]*)/gi,
      /Article\s+([A-Z]{1,3}\d*[A-Z]*)\d+/gi,
      /SECTEUR\s+([A-Z]{1,3}\d*[A-Z]*)/gi
    ];

    zonePatterns.forEach(pattern => {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length <= 4) { // Limiter la longueur
          zones.add(match[1].toUpperCase());
        }
      }
    });

    return Array.from(zones).sort();
  }
}

// Export du service
export const pluExtractorService = new PLUExtractorService();