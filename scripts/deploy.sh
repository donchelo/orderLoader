#!/bin/bash

# --- CONFIGURACIÓN ---
PROJECT_ID="gen-lang-client-0666118566"
ZONE="us-central1-a"
INSTANCE_NAME="orderloader"
VM_USER="ia_tamaprint"
REMOTE_PATH="~/orderLoader"
ARCHIVE_NAME="project_update.tar.gz"

echo "🚀 Iniciando despliegue hacia Google Cloud VM..."

# 1. Comprimir archivos (excluyendo lo innecesario)
echo "📦 Comprimiendo archivos en la laptop..."
tar --exclude=node_modules --exclude=.next --exclude=.git --exclude=$ARCHIVE_NAME -czf $ARCHIVE_NAME .

# 2. Subir a la VM
echo "📤 Subiendo a la VM ($INSTANCE_NAME)..."
gcloud compute scp --project $PROJECT_ID --zone $ZONE $ARCHIVE_NAME $VM_USER@$INSTANCE_NAME:~/

# 3. Ejecutar comandos remotos
echo "⚙️ Configurando y reiniciando en la VM..."
gcloud compute ssh $VM_USER@$INSTANCE_NAME --zone $ZONE --command "
  mkdir -p $REMOTE_PATH && \
  tar -xzf ~/$ARCHIVE_NAME -C $REMOTE_PATH && \
  rm ~/$ARCHIVE_NAME && \
  cd $REMOTE_PATH && \
  npm install && \
  npm run build && \
  echo '♻️ Reiniciando servidor...' && \
  (lsof -ti:3000 | xargs kill -9 2>/dev/null || true) && \
  nohup npm run start > ~/orderLoader/server.log 2>&1 &
"

# 4. Limpieza local
rm $ARCHIVE_NAME

echo "✅ ¡Despliegue completado con éxito! El sistema está actualizado y corriendo en la nube."
