# ... pasos anteriores

# 3. Copia solo package.json
# Eliminamos package-lock.json si el problema persiste,
# pero esto rompe el caché de Docker si solo cambias index.js
COPY package.json ./

# 4. Instala las dependencias (npm genera el package-lock.json dentro del contenedor)
RUN npm install

# 5. Copia el resto de los archivos (index.js, etc.)
COPY . .

# ... pasos posteriores
