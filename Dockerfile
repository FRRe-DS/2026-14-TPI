# Usa una imagen oficial y ligera de Node.js
FROM node:20-alpine

# Define el directorio de trabajo dentro del contenedor
WORKDIR /app

# Copia los archivos de gestión de dependencias
COPY package*.json ./

# Instala las dependencias (incluyendo devDependencies para compilar)
RUN npm install

# Copia el resto del código fuente (src, tsconfig.json, etc.)
COPY . .

# Compila TypeScript (genera los archivos JS en la salida configurada)
RUN npm run build

# Expone el puerto en el que corre tu app (ej. 3000)
EXPOSE 3000

# Comando para iniciar la aplicación ya compilada
CMD ["npm", "run", "start"]