# 📦 OrderLoader 3.0

**OrderLoader** es una solución automatizada de nivel empresarial diseñada para la ingesta de pedidos en **SAP Business One**. Utiliza Inteligencia Artificial (Anthropic Claude) para transformar documentos PDF no estructurados recibidos por correo electrónico en datos precisos listos para el ERP.

---

## 🚀 Propósito del Proyecto
Este sistema elimina la entrada manual de datos de pedidos, reduciendo errores humanos y acelerando el ciclo de ventas. El flujo completo abarca desde la monitorización de bandejas de entrada hasta la notificación final al cliente o equipo de ventas.

## 🛠️ Stack Tecnológico
- **Frontend/Backend:** [Next.js 15+](https://nextjs.org/) (App Router)
- **Base de Datos:** SQLite con [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **IA:** [Anthropic SDK](https://www.anthropic.com/) (Claude 3.x)
- **SAP Integration:** SAP Business One Service Layer (v2)
- **Email:** `imapflow` (descarga) y `nodemailer` (notificaciones)
- **Parsing:** `pdf-parse` e integración con modelos LLM vision-capable.

---

## ⚙️ El Pipeline de 8 Pasos
El corazón de OrderLoader es un pipeline secuencial y robusto que procesa cada pedido individualmente:

1.  **Step 0: Download** — Se conecta via IMAP para obtener el correo más antiguo sin procesar y descarga sus adjuntos.
2.  **Step 1: Parse** — Utiliza IA para extraer datos estructurados (Cabecera, Líneas,Cantidades) del PDF.
3.  **Step 2: Validate Parse** — Verifica que la IA haya extraído campos obligatorios y con el formato correcto.
4.  **Step 3: SAP Query** — Valida en tiempo real si el cliente y los artículos existen en la base de datos de SAP B1.
5.  **Step 4: Upload** — Crea el Borrador de Pedido (Draft) o Pedido en SAP a través del Service Layer.
6.  **Step 5: Reconcile** — Verifica que el objeto se haya creado correctamente en SAP y recupera su número de documento.
7.  **Step 6: Notify** — Envía un correo de confirmación con el resumen o un aviso de error si algo falló.
8.  **Step 7: Archive** — Mueve los archivos procesados a carpetas de historial y marca el registro como finalizado en la DB local.

---

## 🛠️ Configuración e Instalación

### Requisitos Previos
- Node.js 20+
- Docker y Docker Compose (Opcional para despliegue)
- Acceso al Service Layer de SAP B1
- API Key de Anthropic

### Variables de Entorno
Crea un archivo `.env` en la raíz basado en el archivo `.env.example`:
```bash
cp .env.example .env
```

### Ejecución Local
```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev
```

### Ejecución con Docker
El proyecto está optimizado para ejecutarse en contenedores:
```bash
docker-compose up -d --build
```
*Los datos de SQLite y los adjuntos se persisten en el volumen local `./.data`.*

---

## 📁 Estructura del Proyecto
- `/app`: Interfaz de usuario y rutas API.
- `/lib/steps`: Lógica individual de cada paso del proceso de carga.
- `/lib/sap-client.ts`: Cliente para la interacción con el Service Layer de SAP.
- `/scripts`: Utilidades para mantenimiento y cálculo de costos de IA.
- `/public`: Activos estáticos.

---

## 🛡️ Notas de Seguridad y Backup
- El sistema realiza un **Backup automático** de la base de datos local antes de iniciar cada ejecución del pipeline a gran escala.
- Todas las conexiones a SAP y correo electrónico están protegidas mediante variables de entorno.

---

Developed for **Tamaprint** | 2026
