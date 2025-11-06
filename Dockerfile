# Usa una imagen base oficial de Node.js (versión 20 es estable)
FROM node:20-slim

# Crea y establece el directorio de la aplicación
WORKDIR /app

# Copia el package.json y package-lock.json para instalar dependencias
COPY package*.json ./

# Instala las dependencias. 
# Si estás usando npm, usa `npm install`. Si usas yarn, usa `yarn install`.
RUN npm install

# Copia el resto de los archivos de tu aplicación
COPY . .

# Expone el puerto que usa tu aplicación (debe coincidir con tu index.js, que usa 8080)
EXPOSE 8080

# Comando para iniciar la aplicación
# Asume que tu script de inicio en package.json es "start": "node index.js"
CMD [ "npm", "start" ]
