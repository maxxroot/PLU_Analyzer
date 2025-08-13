// src/services/pdf-document.service.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface PLUDocument {
  id: string;
  name: string;
  type: 'reglement' | 'zonage' | 'oap' | 'annexe';
  url: string;
  originalUrl?: string;
  size?: number;
  lastModified?: string;
  downloaded?: boolean;
  error?: string;
}

export interface DocumentDownloadResult {
  success: boolean;
  document?: PLUDocument;
  localPath?: string;
  error?: string;
  cached?: boolean;
}

export class PDFDocumentService {
  private readonly CACHE_DIR = path.join(process.cwd(), 'cache', 'plu-documents');
  private readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB max
  private readonly DOWNLOAD_TIMEOUT = 30000; // 30 secondes

  constructor() {
    this.ensureCacheDirectory();
  }

  /**
   * Assure que le répertoire de cache existe
   */
  private async ensureCacheDirectory() {
    try {
      await fs.mkdir(this.CACHE_DIR, { recursive: true });
      console.log(`📁 Répertoire cache créé: ${this.CACHE_DIR}`);
    } catch (error) {
      console.warn('⚠️ Impossible de créer le répertoire cache:', error);
    }
  }

  /**
   * Génère un identifiant unique pour un document
   */
  private generateDocumentId(url: string): string {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  /**
   * Génère un nom de fichier sécurisé
   */
  private generateSafeFilename(originalName: string, url: string): string {
    // Nettoyer le nom original
    const cleanName = originalName
      .replace(/[^a-zA-Z0-9\-_\.\s]/g, '')
      .replace(/\s+/g, '_')
      .toLowerCase();
    
    // Ajouter timestamp pour éviter les conflits
    const timestamp = Date.now();
    const hash = this.generateDocumentId(url).substring(0, 8);
    
    return `${cleanName}_${timestamp}_${hash}.pdf`;
  }

  /**
   * Détecte le type de document PLU à partir de l'URL et du nom
   */
  private detectDocumentType(name: string, url: string): PLUDocument['type'] {
    const nameAndUrl = `${name} ${url}`.toLowerCase();
    
    if (nameAndUrl.includes('reglement') || nameAndUrl.includes('règlement')) {
      return 'reglement';
    }
    if (nameAndUrl.includes('zonage') || nameAndUrl.includes('plan')) {
      return 'zonage';
    }
    if (nameAndUrl.includes('oap') || nameAndUrl.includes('orientation')) {
      return 'oap';
    }
    
    return 'annexe';
  }

  /**
   * Vérifie si un document est déjà en cache
   */
  private async isDocumentCached(documentId: string): Promise<{ cached: boolean; path?: string; size?: number }> {
    try {
      const files = await fs.readdir(this.CACHE_DIR);
      const matchingFile = files.find(file => file.includes(documentId));
      
      if (matchingFile) {
        const filePath = path.join(this.CACHE_DIR, matchingFile);
        const stats = await fs.stat(filePath);
        
        return {
          cached: true,
          path: filePath,
          size: stats.size
        };
      }
      
      return { cached: false };
    } catch (error) {
      console.warn('⚠️ Erreur vérification cache:', error);
      return { cached: false };
    }
  }

  /**
   * Télécharge un document PDF depuis une URL
   */
  async downloadDocument(url: string, name: string): Promise<DocumentDownloadResult> {
    console.log(`📄 Téléchargement document: ${name} depuis ${url}`);
    
    try {
      const documentId = this.generateDocumentId(url);
      
      // Vérifier le cache
      const cacheResult = await this.isDocumentCached(documentId);
      if (cacheResult.cached && cacheResult.path) {
        console.log(`✅ Document en cache: ${cacheResult.path}`);
        
        const document: PLUDocument = {
          id: documentId,
          name,
          type: this.detectDocumentType(name, url),
          url: `/api/documents/download/${documentId}`,
          originalUrl: url,
          size: cacheResult.size,
          downloaded: true
        };
        
        return {
          success: true,
          document,
          localPath: cacheResult.path,
          cached: true
        };
      }

      // Télécharger le document
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.DOWNLOAD_TIMEOUT);

      console.log(`📥 Téléchargement depuis: ${url}`);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'PLU-Analyzer/1.0 (Document downloader)',
          'Accept': 'application/pdf,*/*'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Vérifier la taille
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > this.MAX_FILE_SIZE) {
        throw new Error(`Fichier trop volumineux: ${Math.round(parseInt(contentLength) / 1024 / 1024)}MB (max: ${Math.round(this.MAX_FILE_SIZE / 1024 / 1024)}MB)`);
      }

      // Vérifier le type de contenu
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('pdf') && !contentType.includes('octet-stream')) {
        console.warn(`⚠️ Type de contenu inattendu: ${contentType}`);
      }

      // Télécharger le contenu
      const buffer = Buffer.from(await response.arrayBuffer());
      
      // Vérifier la taille finale
      if (buffer.length > this.MAX_FILE_SIZE) {
        throw new Error(`Fichier téléchargé trop volumineux: ${Math.round(buffer.length / 1024 / 1024)}MB`);
      }

      // Vérifier que c'est bien un PDF
      if (!buffer.subarray(0, 4).toString().includes('%PDF')) {
        console.warn(`⚠️ Le fichier ne semble pas être un PDF valide`);
      }

      // Sauvegarder en cache
      const filename = this.generateSafeFilename(name, url);
      const localPath = path.join(this.CACHE_DIR, filename);
      
      await fs.writeFile(localPath, buffer);
      
      console.log(`✅ Document téléchargé: ${localPath} (${Math.round(buffer.length / 1024)}KB)`);

      const document: PLUDocument = {
        id: documentId,
        name,
        type: this.detectDocumentType(name, url),
        url: `/api/documents/download/${documentId}`,
        originalUrl: url,
        size: buffer.length,
        lastModified: new Date().toISOString(),
        downloaded: true
      };

      return {
        success: true,
        document,
        localPath,
        cached: false
      };

    } catch (error) {
      console.error(`❌ Erreur téléchargement document:`, error);
      
      const document: PLUDocument = {
        id: this.generateDocumentId(url),
        name,
        type: this.detectDocumentType(name, url),
        url,
        originalUrl: url,
        downloaded: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };

      return {
        success: false,
        document,
        error: error instanceof Error ? error.message : 'Erreur de téléchargement'
      };
    }
  }

  /**
   * Traite plusieurs documents en parallèle
   */
  async downloadDocuments(documents: { name: string; url: string }[]): Promise<DocumentDownloadResult[]> {
    console.log(`📚 Téléchargement de ${documents.length} document(s)...`);
    
    const results = await Promise.allSettled(
      documents.map(doc => this.downloadDocument(doc.url, doc.name))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`❌ Erreur document ${index}:`, result.reason);
        return {
          success: false,
          document: {
            id: this.generateDocumentId(documents[index].url),
            name: documents[index].name,
            type: this.detectDocumentType(documents[index].name, documents[index].url),
            url: documents[index].url,
            originalUrl: documents[index].url,
            downloaded: false,
            error: result.reason?.message || 'Erreur de téléchargement'
          },
          error: result.reason?.message || 'Erreur de téléchargement'
        };
      }
    });
  }

  /**
   * Récupère un document depuis le cache par son ID
   */
  async getDocumentFromCache(documentId: string): Promise<{ found: boolean; path?: string; contentType?: string }> {
    try {
      const files = await fs.readdir(this.CACHE_DIR);
      const matchingFile = files.find(file => file.includes(documentId));
      
      if (matchingFile) {
        const filePath = path.join(this.CACHE_DIR, matchingFile);
        
        // Vérifier que le fichier existe encore
        await fs.access(filePath);
        
        return {
          found: true,
          path: filePath,
          contentType: 'application/pdf'
        };
      }
      
      return { found: false };
    } catch (error) {
      console.warn(`⚠️ Erreur récupération cache pour ${documentId}:`, error);
      return { found: false };
    }
  }

  /**
   * Nettoie le cache (supprime les anciens fichiers)
   */
  async cleanCache(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<{ cleaned: number; errors: number }> {
    console.log(`🧹 Nettoyage du cache (fichiers > ${Math.round(maxAgeMs / 1000 / 60 / 60 / 24)} jours)...`);
    
    let cleaned = 0;
    let errors = 0;
    
    try {
      const files = await fs.readdir(this.CACHE_DIR);
      const now = Date.now();
      
      for (const file of files) {
        try {
          const filePath = path.join(this.CACHE_DIR, file);
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtime.getTime() > maxAgeMs) {
            await fs.unlink(filePath);
            cleaned++;
            console.log(`🗑️ Supprimé: ${file}`);
          }
        } catch (error) {
          console.warn(`⚠️ Erreur suppression ${file}:`, error);
          errors++;
        }
      }
      
      console.log(`✅ Nettoyage terminé: ${cleaned} fichiers supprimés, ${errors} erreurs`);
      
    } catch (error) {
      console.error(`❌ Erreur nettoyage cache:`, error);
      errors++;
    }
    
    return { cleaned, errors };
  }

  /**
   * Obtient des statistiques sur le cache
   */
  async getCacheStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    oldestFile?: string;
    newestFile?: string;
    averageSize: number;
  }> {
    try {
      const files = await fs.readdir(this.CACHE_DIR);
      let totalSize = 0;
      let oldestTime = Date.now();
      let newestTime = 0;
      let oldestFile = '';
      let newestFile = '';
      
      for (const file of files) {
        try {
          const filePath = path.join(this.CACHE_DIR, file);
          const stats = await fs.stat(filePath);
          
          totalSize += stats.size;
          
          if (stats.mtime.getTime() < oldestTime) {
            oldestTime = stats.mtime.getTime();
            oldestFile = file;
          }
          
          if (stats.mtime.getTime() > newestTime) {
            newestTime = stats.mtime.getTime();
            newestFile = file;
          }
        } catch (error) {
          // Ignorer les erreurs sur fichiers individuels
        }
      }
      
      return {
        totalFiles: files.length,
        totalSize,
        oldestFile: oldestFile || undefined,
        newestFile: newestFile || undefined,
        averageSize: files.length > 0 ? totalSize / files.length : 0
      };
      
    } catch (error) {
      console.error(`❌ Erreur stats cache:`, error);
      return {
        totalFiles: 0,
        totalSize: 0,
        averageSize: 0
      };
    }
  }
}

// Export du service
export const pdfDocumentService = new PDFDocumentService();