#!/bin/bash
# scripts/install-dependencies.sh

echo "🔧 Installation des dépendances manquantes..."

# Dépendances pour PDF
npm install --save pdf-parse

# Types pour PDF
npm install --save-dev @types/pdf-parse

# Redis (si nécessaire)
npm install --save redis@^4.6.5

# Types pour Node.js
npm install --save-dev @types/node

# Validation express
npm install --save express-validator

echo "✅ Dépendances installées"

# Créer le fichier vite-env.d.ts s'il n'existe pas
if [ ! -f "vite-env.d.ts" ]; then
  cat > vite-env.d.ts << 'EOF'
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
EOF
  echo "📝 Fichier vite-env.d.ts créé"
fi

# Créer le dossier types s'il n'existe pas
mkdir -p src/types

echo "🎯 Installation terminée !"
echo ""
echo "📋 Prochaines étapes :"
echo "1. Copier le fichier src/types/plu.types.ts"
echo "2. Mettre à jour tsconfig.json"
echo "3. Corriger les middlewares dans server.ts"
echo "4. Tester: npm run type-check"