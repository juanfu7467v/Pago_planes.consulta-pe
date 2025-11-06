# 1. Usa una imagen base oficial de Node.js (versión 20 estable y ligera)
FROM node:20-slim

# 2. Crea y establece el directorio de la aplicación
WORKDIR /app

# 3. Copia solo los archivos package.json y package-lock.json (ya que sabemos que existen)
# Si package-lock.json existe, este paso funciona.
# Si el problema persiste, es la única forma.
COPY package.json package-lock.json ./

# 4. Instala las dependencias
# El --silent es solo para tener un log más limpio
RUN npm install --silent

# 5. Copia el resto de los archivos (index.js, fly.toml, etc.)
# En este punto, el BUILDER ya tiene las dependencias instaladas.
COPY . .

# 6. Expone el puerto que usa tu aplicación (8080 en index.js)
EXPOSE 8080

# 7. Comando para iniciar la aplicación
CMD [ "npm", "start" ]
