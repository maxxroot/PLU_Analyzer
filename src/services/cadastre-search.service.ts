// src/services/cadastre-search.service.ts
export interface CadastreSearchParams {
    codePostal: string;
    commune: string;
    numeroParcelle: string;
  }
  
  export interface CommuneData {
    nom: string;
    code: string;
    codeDepartement: string;
    codeRegion: string;
    codesPostaux: string[];
    population: number;
  }
  
  export interface ParcelleResult {
    id: string;
    commune: string;
    section: string;
    numero: string;
    prefixe: string;
    contenance: number;
    centroid: [number, number]; // [longitude, latitude]
    geometry: any;
  }
  
  export class CadastreSearchService {
    private readonly COMMUNE_API = "https://geo.api.gouv.fr/communes";
    private readonly CADASTRE_API = "https://apicarto.ign.fr/api/cadastre";
  
    /**
     * Recherche une commune par nom et code postal
     */
    async searchCommune(nomCommune: string, codePostal: string): Promise<CommuneData | null> {
      try {
        console.log(`🔍 Recherche commune: "${nomCommune}" (${codePostal})`);
        
        // Nettoyer le nom de la commune
        const cleanNom = this.cleanCommuneName(nomCommune);
        console.log(`🔍 Nom nettoyé: "${cleanNom}"`);
        
        // Essayer plusieurs stratégies de recherche
        const strategies = [
          // 1. Recherche exacte avec nom original
          `${this.COMMUNE_API}?nom=${encodeURIComponent(nomCommune)}&codePostal=${codePostal}`,
          // 2. Recherche avec nom nettoyé
          `${this.COMMUNE_API}?nom=${encodeURIComponent(cleanNom)}&codePostal=${codePostal}`,
          // 3. Recherche par code postal seulement
          `${this.COMMUNE_API}?codePostal=${codePostal}`,
          // 4. Recherche sans code postal
          `${this.COMMUNE_API}?nom=${encodeURIComponent(nomCommune)}`,
          // 5. Recherche avec variantes Saint/Sainte
          `${this.COMMUNE_API}?nom=${encodeURIComponent(nomCommune.replace(/sainte-/gi, 'ste-').replace(/saint-/gi, 'st-'))}&codePostal=${codePostal}`
        ];
        
        for (let i = 0; i < strategies.length; i++) {
          const url = strategies[i];
          console.log(`🔍 Stratégie ${i + 1}: ${url}`);
          
          try {
            const response = await fetch(url + '&fields=nom,code,codeDepartement,codeRegion,codesPostaux,population&format=json&geometry=centre');
            
            if (!response.ok) {
              console.log(`⚠️ Erreur ${response.status} pour stratégie ${i + 1}`);
              continue;
            }
            
            const communes = await response.json();
            console.log(`📍 ${communes?.length || 0} commune(s) trouvée(s) avec stratégie ${i + 1}`);
            
            if (!communes || communes.length === 0) {
              continue;
            }
            
            // Trouver la meilleure correspondance
            let bestMatch = null;
            
            for (const commune of communes) {
              console.log(`🔍 Évaluation: ${commune.nom} (${commune.code}) - CP: ${commune.codesPostaux?.join(',')}`);
              
              // Vérifier le code postal
              const hasMatchingPostcode = !codePostal || 
                commune.codesPostaux?.includes(codePostal) ||
                commune.codesPostaux?.some((cp: string) => cp === codePostal);
              
              // Vérifier le nom (avec variantes)
              const nameVariants = [
                nomCommune.toLowerCase(),
                cleanNom.toLowerCase(),
                nomCommune.toLowerCase().replace(/sainte-/g, 'ste-').replace(/saint-/g, 'st-'),
                commune.nom.toLowerCase(),
                commune.nom.toLowerCase().replace(/sainte-/g, 'ste-').replace(/saint-/g, 'st-')
              ];
              
              const hasMatchingName = nameVariants.some(variant1 => 
                nameVariants.some(variant2 => 
                  variant1.includes(variant2) || variant2.includes(variant1)
                )
              );
              
              if (hasMatchingPostcode && hasMatchingName) {
                bestMatch = commune;
                console.log(`✅ Correspondance trouvée: ${commune.nom} (${commune.code})`);
                break;
              } else if (hasMatchingPostcode && !bestMatch) {
                bestMatch = commune;
                console.log(`📍 Correspondance partielle (CP): ${commune.nom} (${commune.code})`);
              }
            }
            
            if (bestMatch) {
              return {
                nom: bestMatch.nom,
                code: bestMatch.code,
                codeDepartement: bestMatch.codeDepartement,
                codeRegion: bestMatch.codeRegion,
                codesPostaux: bestMatch.codesPostaux || [codePostal],
                population: bestMatch.population || 0
              };
            }
            
          } catch (error) {
            console.warn(`⚠️ Erreur stratégie ${i + 1}:`, error);
            continue;
          }
        }
        
        console.log(`❌ Aucune commune trouvée pour "${nomCommune}" (${codePostal})`);
        return null;
        
      } catch (error) {
        console.error(`❌ Erreur recherche commune:`, error);
        return null;
      }
    }
  
    /**
     * Recherche par code postal uniquement (fallback)
     */
    private async searchCommuneByPostalCode(codePostal: string): Promise<CommuneData | null> {
      try {
        const url = `${this.COMMUNE_API}?codePostal=${codePostal}&fields=nom,code,codeDepartement,codeRegion,codesPostaux,population&format=json&geometry=centre`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          return null;
        }
        
        const communes = await response.json();
        
        if (communes && communes.length > 0) {
          const commune = communes[0];
          console.log(`✅ Commune trouvée par code postal: ${commune.nom}`);
          
          return {
            nom: commune.nom,
            code: commune.code,
            codeDepartement: commune.codeDepartement,
            codeRegion: commune.codeRegion,
            codesPostaux: commune.codesPostaux || [codePostal],
            population: commune.population || 0
          };
        }
        
        return null;
      } catch (error) {
        console.error(`❌ Erreur recherche par code postal:`, error);
        return null;
      }
    }
  
    /**
     * Recherche une parcelle cadastrale
     */
    async searchParcelle(params: CadastreSearchParams): Promise<ParcelleResult | null> {
      try {
        console.log(`🗺️ Recherche parcelle: ${params.numeroParcelle} à ${params.commune} (${params.codePostal})`);
        
        // 1. D'abord trouver la commune
        const communeData = await this.searchCommune(params.commune, params.codePostal);
        
        if (!communeData) {
          throw new Error(`Commune "${params.commune}" non trouvée pour le code postal ${params.codePostal}`);
        }
        
        // 2. Parser la référence parcellaire
        const { section, numero } = this.parseParcelReference(params.numeroParcelle);
        
        // 3. Rechercher la parcelle par différentes méthodes
        let parcelle = await this.searchParcelleByReference(communeData.code, section, numero);
        
        if (!parcelle) {
          // Fallback: recherche élargie
          parcelle = await this.searchParcelleElargie(communeData.code, params.numeroParcelle);
        }
        
        if (!parcelle) {
          throw new Error(`Parcelle "${params.numeroParcelle}" non trouvée dans la commune ${communeData.nom}`);
        }
        
        console.log(`✅ Parcelle trouvée: ${parcelle.id}`);
        return parcelle;
        
      } catch (error) {
        console.error(`❌ Erreur recherche parcelle:`, error);
        throw error;
      }
    }
  
    /**
     * Recherche parcelle par référence exacte
     */
    private async searchParcelleByReference(codeCommune: string, section: string, numero: string): Promise<ParcelleResult | null> {
      try {
        // Le numéro doit faire 4 chiffres pour l'API cadastre
        const numeroFormatted = numero.padStart(4, '0');
        
        console.log(`🔍 Recherche parcelle: commune=${codeCommune}, section=${section}, numero=${numeroFormatted}`);
        
        // Essayer plusieurs formats d'API
        const urls = [
          // Format 1: avec paramètres séparés (la section ne doit PAS être paddée)
          `${this.CADASTRE_API}/parcelle?code_insee=${codeCommune}&section=${section}&numero=${numeroFormatted}`,
          // Format 2: recherche toutes les parcelles de la commune pour filtrer
          `${this.CADASTRE_API}/parcelle?code_insee=${codeCommune}`,
        ];
        
        for (const url of urls) {
          try {
            console.log(`🔍 Essai URL: ${url}`);
            const response = await fetch(url);
            
            if (!response.ok) {
              console.log(`⚠️ Réponse ${response.status} pour ${url}`);
              continue;
            }
            
            const data = await response.json();
            
            if (!data.features || data.features.length === 0) {
              console.log(`⚠️ Aucune feature trouvée pour ${url}`);
              continue;
            }
            
            // Si on a récupéré toutes les parcelles de la commune, filtrer
            if (url.includes('code_insee') && !url.includes('section=')) {
              console.log(`🔍 Filtrage parmi ${data.features.length} parcelles...`);
              
              const matchingFeature = data.features.find((feature: any) => {
                const props = feature.properties;
                console.log(`🔍 Comparaison: section="${props.section}" vs "${section}", numero="${props.numero}" vs "${numeroFormatted}"`);
                
                // Comparaisons multiples pour la section (avec et sans padding)
                const sectionMatches = props.section === section || 
                                     props.section === section.padStart(2, '0') ||
                                     props.section.replace(/^0+/, '') === section.replace(/^0+/, '');
                
                // Comparaisons multiples pour le numéro
                const numeroMatches = props.numero === numero || 
                                     props.numero === numeroFormatted ||
                                     props.numero.padStart(4, '0') === numeroFormatted ||
                                     parseInt(props.numero) === parseInt(numero);
                
                return sectionMatches && numeroMatches;
              });
              
              if (matchingFeature) {
                console.log(`✅ Parcelle trouvée par filtrage: ${matchingFeature.properties.id}`);
                return this.formatParcelleResult(matchingFeature);
              } else {
                console.log(`❌ Aucune correspondance trouvée pour section="${section}" numero="${numeroFormatted}"`);
                // Afficher quelques exemples pour debug
                const examples = data.features.slice(0, 3).map((f: any) => 
                  `${f.properties.section}${f.properties.numero}`
                );
                console.log(`🔍 Exemples disponibles: ${examples.join(', ')}`);
              }
            } else {
              // Réponse directe
              const feature = data.features[0];
              console.log(`✅ Parcelle trouvée directement: ${feature.properties.id}`);
              return this.formatParcelleResult(feature);
            }
            
          } catch (urlError) {
            console.warn(`⚠️ Erreur pour ${url}:`, urlError);
            continue;
          }
        }
        
        console.log(`❌ Aucune parcelle trouvée pour ${section}${numeroFormatted}`);
        return null;
        
      } catch (error) {
        console.warn(`⚠️ Erreur recherche par référence:`, error);
        return null;
      }
    }
  
    /**
     * Recherche élargie par nom/référence partielle
     */
    private async searchParcelleElargie(codeCommune: string, reference: string): Promise<ParcelleResult | null> {
      try {
        console.log(`🔍 Recherche élargie pour: ${reference}`);
        
        // Rechercher toutes les parcelles de la commune
        const parcellesUrl = `${this.CADASTRE_API}/parcelle?code_insee=${codeCommune}`;
        const parcellesResponse = await fetch(parcellesUrl);
        
        if (!parcellesResponse.ok) {
          console.log(`⚠️ Erreur ${parcellesResponse.status} lors de la recherche élargie`);
          return null;
        }
        
        const parcellesData = await parcellesResponse.json();
        
        if (!parcellesData.features || parcellesData.features.length === 0) {
          console.log(`⚠️ Aucune parcelle trouvée dans la commune ${codeCommune}`);
          return null;
        }
        
        console.log(`🔍 Recherche dans ${parcellesData.features.length} parcelles...`);
        
        // Parser la référence pour extraire section et numéro
        try {
          const { section, numero } = this.parseParcelReference(reference);
          const numeroFormatted = numero.padStart(4, '0');
          
          console.log(`🔍 Recherche section="${section}" numero="${numeroFormatted}"`);
          
          // Chercher une correspondance exacte d'abord
          for (const feature of parcellesData.features) {
            const props = feature.properties;
            
            const sectionMatches = props.section === section || 
                                 props.section === section.padStart(2, '0') ||
                                 props.section.replace(/^0+/, '') === section.replace(/^0+/, '');
            
            const numeroMatches = props.numero === numero || 
                                 props.numero === numeroFormatted ||
                                 props.numero.padStart(4, '0') === numeroFormatted ||
                                 parseInt(props.numero) === parseInt(numero);
            
            if (sectionMatches && numeroMatches) {
              console.log(`✅ Parcelle trouvée par recherche élargie: ${props.id}`);
              return this.formatParcelleResult(feature);
            }
          }
          
          console.log(`❌ Aucune correspondance exacte trouvée`);
          
          // Si pas de correspondance exacte, chercher des correspondances partielles
          const cleanRef = reference.toUpperCase().replace(/\s+/g, '');
          
          for (const feature of parcellesData.features) {
            const props = feature.properties;
            const parcelRef = `${props.section}${props.numero}`.replace(/\s+/g, '');
            
            if (parcelRef.includes(cleanRef) || cleanRef.includes(parcelRef)) {
              console.log(`✅ Correspondance partielle trouvée: ${props.id}`);
              return this.formatParcelleResult(feature);
            }
          }
          
          console.log(`❌ Aucune correspondance partielle trouvée`);
          return null;
          
        } catch (parseError) {
          console.warn(`⚠️ Erreur parsing référence "${reference}":`, parseError);
          return null;
        }
        
      } catch (error) {
        console.warn(`⚠️ Erreur recherche élargie:`, error);
        return null;
      }
    }
  
    /**
     * Parse une référence parcellaire (ex: "AB 1234", "0A1234", "0X 1074")
     * Format standard français: Section (1-3 caractères alphanumériques) + Numéro (4 chiffres)
     */
    private parseParcelReference(reference: string): { section: string; numero: string } {
      const clean = reference.toUpperCase().replace(/[\s\-_]/g, '');
      
      console.log(`🔍 Parsing parcelle: "${reference}" → "${clean}"`);
      
      // Pattern principal: séparer section et numéro de manière intelligente
      // Chercher la transition entre caractères alphanumériques et chiffres purs
      let section = '';
      let numero = '';
      
      // Trouver où commencent les chiffres de fin (numéro de parcelle)
      const match = clean.match(/^([A-Z0-9]*?)(\d{1,4})$/);
      
      if (match) {
        section = match[1];
        numero = match[2];
        
        console.log(`✅ Match trouvé: section="${section}", numero="${numero}"`);
      } else {
        // Fallback: prendre les 1-3 premiers caractères comme section
        if (clean.length >= 3) {
          // Chercher la dernière séquence de chiffres
          const digitMatch = clean.match(/(\d+)$/);
          if (digitMatch) {
            numero = digitMatch[1];
            section = clean.substring(0, clean.length - numero.length);
          } else {
            throw new Error(`Aucun numéro trouvé dans "${reference}"`);
          }
        } else {
          throw new Error(`Référence trop courte: "${reference}"`);
        }
      }
      
      // Validation de la section
      if (!section || section.length === 0) {
        throw new Error(`Section vide dans "${reference}"`);
      }
      
      if (section.length > 3) {
        throw new Error(`Section trop longue: "${section}". Maximum 3 caractères.`);
      }
      
      // Vérifier que la section contient au moins une lettre
      if (!/[A-Z]/.test(section)) {
        throw new Error(`Section invalide: "${section}". Doit contenir au moins une lettre.`);
      }
      
      // Validation du numéro
      if (!numero || numero.length === 0) {
        throw new Error(`Numéro vide dans "${reference}"`);
      }
      
      if (numero.length > 4) {
        throw new Error(`Numéro trop long: "${numero}". Maximum 4 chiffres.`);
      }
      
      // Assurer que le numéro fait 4 chiffres (padding avec des zéros)
      numero = numero.padStart(4, '0');
      
      console.log(`✅ Parsing final: section="${section}", numero="${numero}"`);
      
      return { section, numero };
    }
  
    /**
     * Formate le résultat d'une parcelle
     */
    private formatParcelleResult(feature: any): ParcelleResult {
      const props = feature.properties;
      
      // Calculer le centroide pour avoir les coordonnées
      const centroid = this.calculateCentroid(feature.geometry);
      
      // Vérifier que nous avons bien un ID valide
      const id = props.id || props.idu || `${props.commune}${props.section}${props.numero}`;
      
      console.log(`📋 Formatage parcelle: ID=${id}, section=${props.section}, numero=${props.numero}`);
      
      return {
        id: id,
        commune: props.commune || 'Commune inconnue',
        section: props.section || '',
        numero: props.numero || '',
        prefixe: props.prefixe || '000',
        contenance: props.contenance || 0,
        centroid,
        geometry: feature.geometry
      };
    }
  
    /**
     * Calcule le centroide d'une géométrie
     */
    private calculateCentroid(geometry: any): [number, number] {
      try {
        if (geometry.type === 'Point') {
          return [geometry.coordinates[0], geometry.coordinates[1]];
        }
        
        if (geometry.type === 'Polygon' && geometry.coordinates && geometry.coordinates[0]) {
          const coords = geometry.coordinates[0];
          
          let x = 0, y = 0;
          for (const coord of coords) {
            x += coord[0];
            y += coord[1];
          }
          
          return [x / coords.length, y / coords.length];
        }
        
        if (geometry.type === 'MultiPolygon' && geometry.coordinates && geometry.coordinates[0]) {
          return this.calculateCentroid({
            type: 'Polygon',
            coordinates: geometry.coordinates[0]
          });
        }
        
        // Fallback: centre de la France
        return [2.213749, 46.227638];
        
      } catch (error) {
        console.warn('⚠️ Erreur calcul centroide:', error);
        return [2.213749, 46.227638];
      }
    }
  
    /**
     * Nettoie le nom d'une commune pour améliorer la recherche
     */
    private cleanCommuneName(nom: string): string {
      return nom.trim()
        .toLowerCase()
        // Normalisation des caractères spéciaux
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Supprime les accents
        // Normalisation des variantes de Saint/Sainte
        .replace(/\bsaint-/g, 'st-')
        .replace(/\bsainte-/g, 'ste-')
        .replace(/\bsaint\s+/g, 'st ')
        .replace(/\bsainte\s+/g, 'ste ')
        // Normalisation des tirets et espaces
        .replace(/\s+/g, ' ')
        .replace(/-+/g, '-')
        .trim();
    }
  
    /**
     * Valide les paramètres de recherche
     */
    validateSearchParams(params: CadastreSearchParams): string[] {
      const errors: string[] = [];
      
      if (!params.codePostal || !/^\d{5}$/.test(params.codePostal)) {
        errors.push('Code postal invalide (5 chiffres requis)');
      }
      
      if (!params.commune || params.commune.length < 2) {
        errors.push('Nom de commune requis (minimum 2 caractères)');
      }
      
      if (!params.numeroParcelle || params.numeroParcelle.length < 2) {
        errors.push('Numéro de parcelle requis');
      }
      
      // Vérifier le format de la parcelle
      try {
        const parsed = this.parseParcelReference(params.numeroParcelle);
        
        // Vérifications supplémentaires
        if (parsed.section.length > 3) {
          errors.push('Section trop longue (maximum 3 caractères)');
        }
        
        if (!/[A-Z]/.test(parsed.section)) {
          errors.push('Section invalide (doit contenir au moins une lettre)');
        }
        
        if (parsed.numero.length > 4) {
          errors.push('Numéro de parcelle trop long (maximum 4 chiffres)');
        }
        
        const numeroInt = parseInt(parsed.numero);
        if (isNaN(numeroInt) || numeroInt < 1 || numeroInt > 9999) {
          errors.push('Numéro de parcelle invalide (doit être entre 1 et 9999)');
        }
        
      } catch (error) {
        errors.push('Format de parcelle invalide (ex: AB1234, 0A1234, AB 1234, AB-1234)');
      }
      
      return errors;
    }
  
    /**
     * Suggestions de communes pour l'autocomplétion
     */
    async suggestCommunes(query: string, codePostal?: string): Promise<CommuneData[]> {
      try {
        if (query.length < 2) return [];
        
        console.log(`🔍 Suggestions communes pour: "${query}"`);
        
        let url = `${this.COMMUNE_API}?nom=${encodeURIComponent(query)}&fields=nom,code,codesPostaux&format=json&limit=10`;
        
        if (codePostal && /^\d{5}$/.test(codePostal)) {
          url += `&codePostal=${codePostal}`;
        }
        
        const response = await fetch(url);
        
        if (!response.ok) {
          return [];
        }
        
        const communes = await response.json();
        
        return (communes || []).map((commune: any) => ({
          nom: commune.nom,
          code: commune.code,
          codeDepartement: commune.codeDepartement,
          codeRegion: commune.codeRegion,
          codesPostaux: commune.codesPostaux || [],
          population: commune.population || 0
        }));
        
      } catch (error) {
        console.warn('⚠️ Erreur suggestions communes:', error);
        return [];
      }
    }
  }
  
  // Export du service
  export const cadastreSearchService = new CadastreSearchService();