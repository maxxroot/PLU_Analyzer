FROM node:18-alpine AS builder

WORKDIR /app

# Copie des fichiers de dépendances
COPY package*.json ./
COPY tsconfig.json ./

# Installation des dépendances
RUN npm ci --only=production && npm cache clean --force

# Copie du code source
COPY src/ ./src/

# Build de l'application
RUN npm run build

# Image de production
FROM node:18-alpine AS production

WORKDIR /app

# Installation des dépendances de production seulement
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copie des fichiers buildés
COPY --from=builder /app/dist ./dist

# Création d'un utilisateur non-root
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Changement de propriétaire des fichiers
RUN chown -R nodejs:nodejs /app
USER nodejs

# Exposition du port
EXPOSE 3000

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3000

# Sanity check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Commande de démarrage
CMD ["npm", "start"]
