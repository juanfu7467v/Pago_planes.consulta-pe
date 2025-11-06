# Usa una imagen base de Node.js ligera
FROM node:18-slim

# Crea y establece el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copia los archivos de definición de dependencias
COPY package*.json ./

# Instala las dependencias del proyecto
RUN npm install

# Copia el código fuente de la aplicación
COPY . .

# Expone el puerto que la aplicación escuchará
# NOTA: Aunque el servidor escucha en $PORT (8080), esta línea es informativa.
EXPOSE 8080

# Comando para iniciar la aplicación
CMD [ "npm", "start" ]
