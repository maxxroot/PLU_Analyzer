// scripts/test-pdf-extraction.ts
import { PLUExtractorService } from '../src/services/pdf-extractor/plu-extractor.service';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Script de test pour l'extraction PDF PLU
 * Usage: npm run test:pdf
 */

// URLs de test avec différents types de PLU
const TEST_URLS = {
  // PLU complexe de grande métropole
  bordeaux: {
    url: 'https://www.bordeaux-metropole.fr/sites/default/files/2023-01/PLU_reglement_zones_U.pdf',
    zones: ['UA', 'UB', 'UC', 'UD'],
    description: 'PLU Bordeaux Métropole - Zones urbaines'
  },
  
  // PLU type commune moyenne
  test_commune: {
    url: 'https://www.legifrance.gouv.fr/download/pdf?id=jorf_text_000000000000&pagejorf_text_000000000000',
    zones: ['UA', 'UB', 'AU', 'A', 'N'],
    description: 'PLU type commune française'
  },
  
  // URL locale pour test de développement
  local_test: {
    url: 'http://localhost:3001/test-plu.pdf',
    zones: ['UB'],
    description: 'Fichier test local'
  }
};

class PLUTestRunner {
  private extractor: PLUExtractorService;
  private results: any[] = [];

  constructor() {
    this.extractor = new PLUExtractorService();
  }

  async runAllTests() {
    console.log('🚀 Début des tests d\'extraction PLU\n');
    
    for (const [key, testCase] of Object.entries(TEST_URLS)) {
      console.log(`📋 Test: ${key} - ${testCase.description}`);
      
      try {
        await this.testPLUExtraction(key, testCase);
      } catch (error) {
        console.error(`❌ Erreur test ${key}:`, error);
        this.results.push({
          test: key,
          success: false,
          error: error instanceof Error ? error.message : 'Erreur inconnue'
        });
      }
      
      console.log(''); // Ligne vide entre les tests
    }
    
    await this.generateReport();
  }

  async testPLUExtraction(testName: string, testCase: any) {
    const startTime = Date.now();
    
    try {
      // Test 1: Extraction zone par zone
      console.log(`  🔍 Test extraction par zone...`);
      const zoneResults = [];
      
      for (const zone of testCase.zones) {
        try {
          const result = await this.extractor.extractFromPDF(testCase.url, zone, {
            useAI: true,
            timeout: 30000
          });
          
          zoneResults.push({
            zone,
            success: true,
            confidence: result.confidence,
            rulesCount: this.countRules(result),
            method: result.confidence > 0.8 ? 'traditional' : 'ai'
          });
          
          console.log(`    ✅ ${zone}: ${Math.round(result.confidence * 100)}% confiance, ${this.countRules(result)} règles`);
          
        } catch (zoneError) {
          zoneResults.push({
            zone,
            success: false,
            error: zoneError instanceof Error ? zoneError.message : 'Erreur zone'
          });
          
          console.log(`    ❌ ${zone}: ${zoneError instanceof Error ? zoneError.message : 'Erreur'}`);
        }
      }
      
      // Test 2: Extraction complète du document
      console.log(`  🔍 Test extraction complète...`);
      let fullExtractionResult;
      
      try {
        const allZones = await this.extractor.extractAllZones(testCase.url, {
          useAI: true,
          timeout: 60000
        });
        
        fullExtractionResult = {
          success: true,
          zonesDetected: allZones.length,
          averageConfidence: allZones.reduce((sum, zone) => sum + zone.confidence, 0) / allZones.length
        };
        
        console.log(`    ✅ ${allZones.length} zones détectées, confiance moyenne: ${Math.round(fullExtractionResult.averageConfidence * 100)}%`);
        
      } catch (fullError) {
        fullExtractionResult = {
          success: false,
          error: fullError instanceof Error ? fullError.message : 'Erreur extraction complète'
        };
        
        console.log(`    ❌ Extraction complète échouée: ${fullExtractionResult.error}`);
      }
      
      const duration = Date.now() - startTime;
      
      // Compter les usages
    if (analysis.usagesAutorises) count += analysis.usagesAutorises.length;
    if (analysis.usagesInterdits) count += analysis.usagesInterdits.length;
    if (analysis.usagesConditionnes) count += analysis.usagesConditionnes.length;
    
    return count;
  }

  private async generateReport() {
    console.log('📊 RAPPORT DE TEST - EXTRACTION PLU');
    console.log('='.repeat(50));
    
    const successfulTests = this.results.filter(r => r.success);
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    
    console.log(`\n📈 STATISTIQUES GLOBALES:`);
    console.log(`  Tests réussis: ${successfulTests.length}/${this.results.length}`);
    console.log(`  Durée totale: ${totalDuration}ms`);
    console.log(`  Durée moyenne: ${Math.round(totalDuration / this.results.length)}ms`);
    
    // Détail par test
    for (const result of this.results) {
      console.log(`\n🔍 ${result.test.toUpperCase()}:`);
      console.log(`  URL: ${result.url}`);
      console.log(`  Statut: ${result.success ? '✅ Réussi' : '❌ Échoué'}`);
      console.log(`  Durée: ${result.duration}ms`);
      
      if (result.success && result.summary) {
        console.log(`  Zones extraites: ${result.summary.successfulZones}/${result.summary.totalZones}`);
        console.log(`  Confiance moyenne: ${Math.round(result.summary.averageConfidence * 100)}%`);
      }
      
      if (result.zoneResults) {
        console.log(`  Détail par zone:`);
        result.zoneResults.forEach((zone: any) => {
          if (zone.success) {
            console.log(`    ${zone.zone}: ${Math.round(zone.confidence * 100)}% (${zone.rulesCount} règles, ${zone.method})`);
          } else {
            console.log(`    ${zone.zone}: ❌ ${zone.error}`);
          }
        });
      }
      
      if (!result.success && result.error) {
        console.log(`  Erreur: ${result.error}`);
      }
    }
    
    // Recommandations
    console.log(`\n💡 RECOMMANDATIONS:`);
    
    const avgConfidence = successfulTests.reduce((sum, r) => sum + (r.summary?.averageConfidence || 0), 0) / Math.max(successfulTests.length, 1);
    
    if (avgConfidence < 0.7) {
      console.log(`  ⚠️  Confiance moyenne faible (${Math.round(avgConfidence * 100)}%) - Améliorer les patterns regex`);
    } else {
      console.log(`  ✅ Confiance moyenne acceptable (${Math.round(avgConfidence * 100)}%)`);
    }
    
    const avgDuration = totalDuration / this.results.length;
    if (avgDuration > 15000) {
      console.log(`  ⚠️  Durée moyenne élevée (${Math.round(avgDuration)}ms) - Optimiser les performances`);
    } else {
      console.log(`  ✅ Performance acceptable (${Math.round(avgDuration)}ms par test)`);
    }
    
    // Sauvegarde du rapport
    await this.saveReport();
  }

  private async saveReport() {
    const reportData = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: this.results.length,
        successfulTests: this.results.filter(r => r.success).length,
        totalDuration: this.results.reduce((sum, r) => sum + r.duration, 0),
        averageConfidence: this.results
          .filter(r => r.success && r.summary)
          .reduce((sum, r) => sum + r.summary!.averageConfidence, 0) / Math.max(this.results.filter(r => r.success).length, 1)
      },
      results: this.results
    };
    
    const reportPath = path.join(process.cwd(), 'test-reports', `plu-extraction-${Date.now()}.json`);
    
    // Créer le dossier s'il n'existe pas
    const reportDir = path.dirname(reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`\n💾 Rapport sauvegardé: ${reportPath}`);
  }

  // Test unitaire pour un pattern spécifique
  async testSpecificPattern() {
    console.log('🔬 TEST PATTERNS SPÉCIFIQUES\n');
    
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
    `;
    
    // Test d'extraction avec le texte exemple
    try {
      const result = await this.extractor.extractFromPDF('test://example', 'UB', { useAI: false });
      
      console.log('Résultats extraction patterns:');
      console.log(`- Hauteur: ${result.hauteurMaximale}m`);
      console.log(`- Étages: R+${result.nombreEtagesMax}`);
      console.log(`- Emprise: ${result.empriseAuSolMax}%`);
      console.log(`- Recul: ${result.reculVoirie}m`);
      console.log(`- Stationnement: ${result.stationnementHabitation} place/logement`);
      console.log(`- Confiance: ${Math.round(result.confidence * 100)}%`);
      
    } catch (error) {
      console.error('❌ Erreur test patterns:', error);
    }
  }

  // Test de performance avec cache
  async testCachePerformance() {
    console.log('⚡ TEST PERFORMANCE CACHE\n');
    
    const testUrl = 'http://example.com/test.pdf';
    const testZone = 'UB';
    
    try {
      // Premier appel (sans cache)
      console.log('1️⃣ Premier appel (sans cache)...');
      const start1 = Date.now();
      await this.extractor.extractFromPDF(testUrl, testZone, { forceRefresh: true });
      const duration1 = Date.now() - start1;
      console.log(`   Durée: ${duration1}ms`);
      
      // Deuxième appel (avec cache)
      console.log('2️⃣ Deuxième appel (avec cache)...');
      const start2 = Date.now();
      await this.extractor.extractFromPDF(testUrl, testZone);
      const duration2 = Date.now() - start2;
      console.log(`   Durée: ${duration2}ms`);
      
      // Calcul amélioration
      const improvement = ((duration1 - duration2) / duration1) * 100;
      console.log(`📊 Amélioration cache: ${Math.round(improvement)}%`);
      
    } catch (error) {
      console.error('❌ Erreur test cache:', error);
    }
  }
}

// Fonction principale
async function main() {
  const args = process.argv.slice(2);
  const testRunner = new PLUTestRunner();
  
  try {
    if (args.includes('--patterns')) {
      await testRunner.testSpecificPattern();
    } else if (args.includes('--cache')) {
      await testRunner.testCachePerformance();
    } else if (args.includes('--all') || args.length === 0) {
      await testRunner.runAllTests();
    } else {
      console.log(`
Usage: npm run test:pdf [options]

Options:
  --all       Exécuter tous les tests (défaut)
  --patterns  Tester les patterns regex spécifiques
  --cache     Tester les performances du cache
  
Examples:
  npm run test:pdf
  npm run test:pdf -- --patterns
  npm run test:pdf -- --cache
      `);
    }
  } catch (error) {
    console.error('❌ Erreur fatale:', error);
    process.exit(1);
  }
}

// Gestion des erreurs non capturées
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Rejection non gérée:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Exception non gérée:', error);
  process.exit(1);
});

// Exécution si appelé directement
if (require.main === module) {
  main();
}

export { PLUTestRunner };ilation des résultats
      this.results.push({
        test: testName,
        url: testCase.url,
        description: testCase.description,
        duration,
        success: zoneResults.some(r => r.success),
        zoneResults,
        fullExtractionResult,
        summary: {
          successfulZones: zoneResults.filter(r => r.success).length,
          totalZones: zoneResults.length,
          averageConfidence: zoneResults
            .filter(r => r.success && r.confidence)
            .reduce((sum, r) => sum + r.confidence!, 0) / Math.max(zoneResults.filter(r => r.success).length, 1)
        }
      });
      
      console.log(`  ⏱️ Test terminé en ${duration}ms`);
      
    } catch (error) {
      throw error;
    }
  }

  private countRules(analysis: any): number {
    let count = 0;
    
    // Compter les règles numériques
    const numericFields = [
      'hauteurMaximale', 'nombreEtagesMax', 'empriseAuSolMax',
      'reculVoirie', 'reculLimitesSeparatives', 'stationnementHabitation'
    ];
    
    numericFields.forEach(field => {
      if (analysis[field] !== null && analysis[field] !== undefined) {
        count++;
      }
    });
    
    // Comp