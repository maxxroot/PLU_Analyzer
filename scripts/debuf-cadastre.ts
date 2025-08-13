// scripts/debug-cadastre.ts - Script de debug pour les problèmes de recherche cadastrale

import { CadastreSearchService } from '../src/services/cadastre-search.service';

/**
 * Script de debug pour analyser les problèmes de recherche cadastrale
 * Usage: npx ts-node scripts/debug-cadastre.ts
 */

class CadastreDebugger {
  private cadastreService: CadastreSearchService;

  constructor() {
    this.cadastreService = new CadastreSearchService();
  }

  async debugSainteMarieDere() {
    console.log('🔍 DEBUG: Sainte-Marie-de-Ré, parcelle 0X 1074\n');

    // 1. Test de la recherche de commune
    console.log('=== 1. RECHERCHE COMMUNE ===');
    try {
      const commune = await this.cadastreService.searchCommune('Sainte-Marie-de-Ré', '17740');
      console.log('Résultat commune:', JSON.stringify(commune, null, 2));
    } catch (error) {
      console.error('Erreur commune:', error);
    }

    // 2. Test avec variantes du nom
    console.log('\n=== 2. VARIANTES NOM COMMUNE ===');
    const variantes = [
      'Sainte-Marie-de-Ré',
      'Sainte Marie de Ré',
      'Ste-Marie-de-Ré', 
      'Ste Marie de Re',
      'SAINTE-MARIE-DE-RE'
    ];

    for (const variante of variantes) {
      try {
        console.log(`\nTest: "${variante}"`);
        const result = await this.cadastreService.searchCommune(variante, '17740');
        console.log(`✅ Trouvé: ${result?.nom} (${result?.code})`);
      } catch (error) {
        console.log(`❌ Échec: ${error}`);
      }
    }

    // 3. Test API directe geo.api.gouv.fr
    console.log('\n=== 3. TEST API DIRECTE ===');
    try {
      const urls = [
        'https://geo.api.gouv.fr/communes?nom=Sainte-Marie-de-Ré&codePostal=17740',
        'https://geo.api.gouv.fr/communes?codePostal=17740',
        'https://geo.api.gouv.fr/communes?nom=Sainte-Marie-de-Re&codePostal=17740'
      ];

      for (const url of urls) {
        console.log(`\nTest URL: ${url}`);
        const response = await fetch(url);
        const data = await response.json();
        console.log(`Statut: ${response.status}, Résultats: ${data.length || 0}`);
        if (data.length > 0) {
          console.log('Premier résultat:', {
            nom: data[0].nom,
            code: data[0].code,
            codesPostaux: data[0].codesPostaux
          });
        }
      }
    } catch (error) {
      console.error('Erreur API directe:', error);
    }

    // 4. Test parsing de la parcelle
    console.log('\n=== 4. PARSING PARCELLE ===');
    const parcelles = ['0X 1074', '0X1074', '0X-1074'];
    
    for (const parcelle of parcelles) {
      try {
        console.log(`\nTest parcelle: "${parcelle}"`);
        // Accès à la méthode privée via reflection pour le debug
        const parsed = (this.cadastreService as any).parseParcelReference(parcelle);
        console.log(`✅ Section: "${parsed.section}", Numéro: "${parsed.numero}"`);
      } catch (error) {
        console.log(`❌ Erreur parsing: ${error}`);
      }
    }

    // 5. Test recherche parcelle complète
    console.log('\n=== 5. RECHERCHE PARCELLE COMPLÈTE ===');
    try {
      const result = await this.cadastreService.searchParcelle({
        codePostal: '17740',
        commune: 'Sainte-Marie-de-Ré',
        numeroParcelle: '0X 1074'
      });

      console.log('Résultat recherche:', result ? {
        id: result.id,
        commune: result.commune,
        section: result.section,
        numero: result.numero,
        coordinates: result.centroid
      } : 'null');
    } catch (error) {
      console.error('Erreur recherche complète:', error);
    }

    // 6. Test API cadastre directe
    console.log('\n=== 6. TEST API CADASTRE DIRECTE ===');
    try {
      // Utiliser le code INSEE de Sainte-Marie-de-Ré (17360)
      const codeInsee = '17360';
      const urls = [
        `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${codeInsee}`,
        `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${codeInsee}&section=0X&numero=1074`,
        `https://apicarto.ign.fr/api/cadastre/commune?code_insee=${codeInsee}`
      ];

      for (const url of urls) {
        console.log(`\nTest URL cadastre: ${url}`);
        const response = await fetch(url);
        console.log(`Statut: ${response.status}`);
        
        if (response.ok) {
          const data = await response.json();
          console.log(`Features trouvées: ${data.features?.length || 0}`);
          
          if (data.features && data.features.length > 0) {
            const sample = data.features[0];
            console.log('Exemple:', {
              id: sample.properties.id,
              section: sample.properties.section,
              numero: sample.properties.numero,
              commune: sample.properties.commune
            });

            // Si c'est la liste des parcelles, chercher 0X
            if (url.includes('code_insee') && !url.includes('section=')) {
              const matching = data.features.filter((f: any) => 
                f.properties.section?.includes('0X') || f.properties.section?.includes('X')
              );
              console.log(`Parcelles avec section X: ${matching.length}`);
              matching.slice(0, 3).forEach((f: any) => {
                console.log(`  - ${f.properties.section}${f.properties.numero}`);
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Erreur API cadastre:', error);
    }

    console.log('\n=== DEBUG TERMINÉ ===');
  }

  async testGeneralCases() {
    console.log('\n🧪 TESTS GÉNÉRAUX\n');

    const testCases = [
      { cp: '75001', commune: 'Paris', parcelle: '0A 1234' },
      { cp: '33000', commune: 'Bordeaux', parcelle: 'AB 1234' },
      { cp: '17740', commune: 'Sainte-Marie-de-Ré', parcelle: '0X 1074' }
    ];

    for (const test of testCases) {
      console.log(`\n--- Test: ${test.commune} ${test.parcelle} ---`);
      
      try {
        const result = await this.cadastreService.validateSearchParams({
          codePostal: test.cp,
          commune: test.commune,
          numeroParcelle: test.parcelle
        });

        console.log(`Validation: ${result.length === 0 ? '✅ OK' : '❌ Erreurs'}`);
        if (result.length > 0) {
          result.forEach(err => console.log(`  - ${err}`));
        }

        if (result.length === 0) {
          const parcelle = await this.cadastreService.searchParcelle({
            codePostal: test.cp,
            commune: test.commune,
            numeroParcelle: test.parcelle
          });

          console.log(`Recherche: ${parcelle ? '✅ Trouvé' : '❌ Non trouvé'}`);
          if (parcelle) {
            console.log(`  ID: ${parcelle.id}`);
            console.log(`  Coordonnées: ${parcelle.centroid[0]}, ${parcelle.centroid[1]}`);
          }
        }
      } catch (error) {
        console.log(`❌ Erreur: ${error}`);
      }
    }
  }
}

// Fonction principale
async function main() {
  const debugger = new CadastreDebugger();
  
  try {
    console.log('🚀 DÉBUT DEBUG CADASTRE\n');
    
    await debugger.debugSainteMarieDere();
    await debugger.testGeneralCases();
    
    console.log('\n✅ DEBUG TERMINÉ');
  } catch (error) {
    console.error('❌ Erreur fatale:', error);
    process.exit(1);
  }
}

// Exécution si appelé directement
if (require.main === module) {
  main();
}

export { CadastreDebugger };