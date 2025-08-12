// services/pdf-analyzer.service.ts
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';

// Types pour l'analyse des PDFs
export interface PLURule {
  category: 'hauteur' | 'implantation' | 'emprise' | 'stationnement' | 'espaces_verts' | 'usage' | 'autres';
  type: 'restriction' | 'autorisation' | 'obligation';
  value?: string | number;
  unit?: string;
  description: string;
  article?: string;
  confidence: number;
}

export interface PLUAnalysis {
  zone: string;
  rules: PLURule[];
  extractedText: string;
  confidence: number;
  source: {
    filename: string;
    page?: number;
    section?: string;
  };
}

export class PDFAnalyzerService {
  
  /**
   * Analyse un PDF de règlement PLU et extrait les règles automatiquement
   */
  async analyzePLUDocument(pdfUrl: string, zone: string): Promise<PLUAnalysis> {
    try {
      // 1. Téléchargement du PDF
      const pdfBuffer = await this.downloadPDF(pdfUrl);
      
      // 2. Extraction du texte
      const extractedText = await this.extractTextFromPDF(pdfBuffer);
      
      // 3. Recherche de la section correspondant à la zone
      const zoneText = this.findZoneSection(extractedText, zone);
      
      // 4. Analyse et extraction des règles
      const rules = this.extractRulesFromText(zoneText, zone);
      
      // 5. Calcul de la confiance globale
      const confidence = this.calculateConfidence(rules, zoneText);
      
      return {
        zone,
        rules,
        extractedText: zoneText,
        confidence,
        source: {
          filename: this.getFilenameFromUrl(pdfUrl)
        }
      };
    } catch (error) {
      console.error('Erreur lors de l\'analyse du PDF:', error);
      throw new Error(`Impossible d'analyser le document PLU: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    }
  }

  /**
   * Télécharge un PDF depuis une URL
   */
  private async downloadPDF(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Impossible de télécharger le PDF: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Extrait le texte d'un PDF
   * Note: En production, utiliser une vraie bibliothèque comme pdf-parse ou pdf2pic + OCR
   */
  private async extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
    // Simulation - en réalité, utiliser pdf-parse ou similaire
    // const pdf = require('pdf-parse');
    // const data = await pdf(pdfBuffer);
    // return data.text;
    
    // Simulation d'extraction de texte d'un règlement PLU typique
    return `
      RÈGLEMENT DU PLU - DISPOSITIONS APPLICABLES AUX ZONES URBAINES
      
      ZONE UB - ZONE URBAINE MIXTE
      
      Article UB1 - Occupations et utilisations du sol interdites
      - Les installations classées soumises à autorisation
      - Les dépôts de véhicules hors d'usage
      - Les terrains de camping et de caravanage
      
      Article UB2 - Occupations et utilisations du sol soumises à conditions particulières
      - Les constructions à usage d'habitation
      - Les constructions à usage de bureaux dans la limite de 500 m²
      - Les installations classées soumises à déclaration
      
      Article UB3 - Conditions de desserte des terrains
      - Accès: Les constructions doivent être édifiées sur un terrain ayant accès à une voie publique
      - Voirie: La largeur de la voie doit être au minimum de 3,5 mètres
      
      Article UB4 - Conditions de desserte par les réseaux
      - Eau potable: Raccordement obligatoire au réseau public
      - Assainissement: Raccordement obligatoire au réseau d'assainissement collectif
      
      Article UB6 - Implantation des constructions par rapport aux voies
      - Recul minimum: 5 mètres par rapport à l'alignement
      - Exception: Les extensions de constructions existantes peuvent respecter l'implantation existante
      
      Article UB7 - Implantation des constructions par rapport aux limites séparatives
      - Recul minimum: 3 mètres ou la moitié de la hauteur avec un minimum de 2,5 mètres
      - Construction sur limite autorisée pour les annexes de moins de 20 m²
      
      Article UB9 - Emprise au sol des constructions
      - L'emprise au sol des constructions ne peut excéder 40% de la superficie du terrain
      
      Article UB10 - Hauteur maximale des constructions
      - Hauteur maximale: 12 mètres au faîtage
      - Nombre d'étages: R+2 maximum
      
      Article UB13 - Espaces libres et plantations
      - Au moins 30% de la superficie du terrain doit être traité en espaces verts
      - Un arbre de haute tige doit être planté par tranche de 200 m² d'espace vert
      
      Article UB12 - Stationnement
      - Habitation: 1 place par logement, 2 places pour les logements de plus de 80 m²
      - Bureaux: 1 place pour 40 m² de surface de plancher
      - Commerces: 1 place pour 50 m² de surface de vente
    `;
  }

  /**
   * Trouve la section correspondant à une zone spécifique
   */
  private findZoneSection(text: string, zone: string): string {
    const zonePattern = new RegExp(`ZONE\\s+${zone}[\\s\\S]*?(?=ZONE\\s+\\w+|$)`, 'i');
    const match = text.match(zonePattern);
    
    if (match) {
      return match[0];
    }
    
    // Si pas de section spécifique trouvée, chercher les articles correspondants
    const articlePattern = new RegExp(`Article\\s+${zone}[\\d\\w]*[\\s\\S]*?(?=Article\\s+(?!${zone})|$)`, 'gi');
    const articles = text.match(articlePattern) || [];
    
    return articles.join('\n\n');
  }

  /**
   * Extrait les règles à partir du texte analysé
   */
  private extractRulesFromText(text: string, zone: string): PLURule[] {
    const rules: PLURule[] = [];

    // Règles de hauteur
    const hauteurMatches = text.match(/hauteur[^.]*?(\d+(?:,\d+)?)\s*(mètres?|m)/gi);
    if (hauteurMatches) {
      hauteurMatches.forEach(match => {
        const valueMatch = match.match(/(\d+(?:,\d+)?)/);
        if (valueMatch) {
          rules.push({
            category: 'hauteur',
            type: 'restriction',
            value: parseFloat(valueMatch[1].replace(',', '.')),
            unit: 'mètres',
            description: `Hauteur maximale : ${valueMatch[1]} mètres`,
            confidence: 0.9
          });
        }
      });
    }

    // Règles d'emprise au sol
    const empriseMatches = text.match(/emprise[^.]*?(\d+)\s*%/gi);
    if (empriseMatches) {
      empriseMatches.forEach(match => {
        const valueMatch = match.match(/(\d+)/);
        if (valueMatch) {
          rules.push({
            category: 'emprise',
            type: 'restriction',
            value: parseInt(valueMatch[1]),
            unit: '%',
            description: `Emprise au sol maximale : ${valueMatch[1]}%`,
            confidence: 0.9
          });
        }
      });
    }

    // Règles de recul
    const reculMatches = text.match(/recul[^.]*?(\d+(?:,\d+)?)\s*(mètres?|m)/gi);
    if (reculMatches) {
      reculMatches.forEach(match => {
        const valueMatch = match.match(/(\d+(?:,\d+)?)/);
        if (valueMatch) {
          rules.push({
            category: 'implantation',
            type: 'restriction',
            value: parseFloat(valueMatch[1].replace(',', '.')),
            unit: 'mètres',
            description: `Recul minimum : ${valueMatch[1]} mètres`,
            confidence: 0.85
          });
        }
      });
    }

    // Règles d'espaces verts
    const espaceVertMatches = text.match(/(?:espaces?\s+verts?|espaces?\s+libres?)[^.]*?(\d+)\s*%/gi);
    if (espaceVertMatches) {
      espaceVertMatches.forEach(match => {
        const valueMatch = match.match(/(\d+)/);
        if (valueMatch) {
          rules.push({
            category: 'espaces_verts',
            type: 'obligation',
            value: parseInt(valueMatch[1]),
            unit: '%',
            description: `Espaces verts obligatoires : ${valueMatch[1]}% minimum`,
            confidence: 0.8
          });
        }
      });
    }

    // Règles de stationnement
    const stationnementMatches = text.match(/(\d+)\s*places?[^.]*?(?:logement|habitation|m²)/gi);
    if (stationnementMatches) {
      stationnementMatches.forEach(match => {
        const valueMatch = match.match(/(\d+)/);
        if (valueMatch) {
          rules.push({
            category: 'stationnement',
            type: 'obligation',
            value: parseInt(valueMatch[1]),
            unit: 'places',
            description: `Stationnement : ${valueMatch[1]} place(s) minimum`,
            confidence: 0.75
          });
        }
      });
    }

    // Règles d'usage autorisé
    const usagesAutorises = [
      'habitation', 'bureau', 'commerce', 'artisanat', 'industrie', 
      'équipement public', 'hébergement hôtelier'
    ];
    
    usagesAutorises.forEach(usage => {
      const usagePattern = new RegExp(`constructions?\\s+à\\s+usage\\s+[^.]*?${usage}`, 'gi');
      const usageMatches = text.match(usagePattern);
      
      if (usageMatches) {
        const isInterdit = /interdites?|prohibées?/i.test(usageMatches[0]);
        rules.push({
          category: 'usage',
          type: isInterdit ? 'restriction' : 'autorisation',
          description: `${usage.charAt(0).toUpperCase() + usage.slice(1)} ${isInterdit ? 'interdit' : 'autorisé'}`,
          confidence: 0.8
        });
      }
    });

    return rules;
  }

  /**
   * Calcule un score de confiance global
   */
  private calculateConfidence(rules: PLURule[], text: string): number {
    if (rules.length === 0) return 0;

    const avgConfidence = rules.reduce((sum, rule) => sum + rule.confidence, 0) / rules.length;
    
    // Bonus si le texte contient des mots-clés structurels du PLU
    const structuralKeywords = ['article', 'zone', 'règlement', 'construction', 'terrain'];
    const keywordCount = structuralKeywords.filter(keyword => 
      new RegExp(keyword, 'i').test(text)
    ).length;
    
    const structuralBonus = Math.min(keywordCount * 0.05, 0.2);
    
    return Math.min(avgConfidence + structuralBonus, 1);
  }

  /**
   * Extrait le nom de fichier depuis une URL
   */
  private getFilenameFromUrl(url: string): string {
    return url.split('/').pop() || 'document.pdf';
  }

  /**
   * Convertit les règles extraites en format standardisé pour l'API
   */
  public formatRulesForAPI(analysis: PLUAnalysis): { restrictions: string[]; rights: string[] } {
    const restrictions: string[] = [];
    const rights: string[] = [];

    analysis.rules.forEach(rule => {
      const description = rule.description;
      
      if (rule.type === 'restriction' || rule.type === 'obligation') {
        restrictions.push(description);
      } else if (rule.type === 'autorisation') {
        rights.push(description);
      }
    });

    // Ajout de restrictions génériques si peu de règles extraites
    if (restrictions.length < 3) {
      restrictions.push('Respecter le règlement de zone en vigueur');
      restrictions.push('Déclaration préalable ou permis requis selon les travaux');
    }

    // Ajout de droits génériques si peu de règles extraites
    if (rights.length < 2) {
      rights.push('Constructions autorisées selon le zonage');
      rights.push('Aménagements conformes au PLU autorisés');
    }

    return { restrictions, rights };
  }

  /**
   * Met en cache les analyses pour éviter de re-analyser les mêmes documents
   */
  private cacheKey(url: string, zone: string): string {
    return `plu_analysis:${Buffer.from(url + zone).toString('base64')}`;
  }

  /**
   * Version avec cache de l'analyse
   */
  async analyzePLUDocumentCached(pdfUrl: string, zone: string, cacheService?: any): Promise<PLUAnalysis> {
    if (cacheService) {
      const cacheKey = this.cacheKey(pdfUrl, zone);
      const cached = await cacheService.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }
      
      const analysis = await this.analyzePLUDocument(pdfUrl, zone);
      
      // Cache pour 24 heures
      await cacheService.setex(cacheKey, 86400, JSON.stringify(analysis));
      
      return analysis;
    }
    
    return this.analyzePLUDocument(pdfUrl, zone);
  }
}

// Export du service
export const pdfAnalyzerService = new PDFAnalyzerService();