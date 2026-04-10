# 📦 OrderLoader 3.0

**OrderLoader** es una solución automatizada de nivel empresarial diseñada para la ingesta de pedidos en **SAP Business One**. Utiliza Inteligencia Artificial (Anthropic Claude) para transformar documentos PDF no estructurados en datos precisos listos para el ERP.

---

## 🚀 Arquitectura en la Nube (Google Cloud VM)
El sistema ha sido migrado de un entorno local a una **VM de Google Cloud** para operación 24/7.

- **URL del Dashboard**: [http://34.59.114.103:3000](http://34.59.114.103:3000)
- **Estado**: Producción (GCP Compute Engine).
- **Zonas**: us-central1-a.

---

## ⚙️ Automatización y Pipeline
El sistema procesa pedidos automáticamente de lunes a domingo.

### ⏰ Horario de Ejecución (Cron)
- **Rango**: 6:00 AM - 10:00 PM (Hora local).
- **Frecuencia**: Cada hora (en el minuto 0).
- **Mecanismo**: Cron job ejecutando `scripts/cron-pipeline.ts` vía `tsx`.

### 📂 Flujo de Carpetas (IMAP)
El pipeline monitoriza y organiza los correos en la cuenta configurada:
1.  **Origen**: `A A INGRESAR IA` (Solo los correos en esta carpeta inician el pipeline).
2.  **Destino (Éxito)**: `A A INGRESADO` (Cuando el pedido se crea en SAP sin observaciones).
3.  **Destino (Revisión)**: `A A REVISAR IA` (Cuando hay errores de IA, validación o SAP).

---

## 🛠️ Herramientas de Desarrollo y Despliegue

### Sincronización desde Laptop → VM
Si realizas cambios en el código localmente, usa el script de despliegue para actualizar la nube automáticamente:
```bash
./scripts/deploy.sh
```
*Este script automatiza: compresión, transferencia via SCP, npm install, build y reinicio del servidor en la VM.*

### Control de Costos de IA
Para ver el consumo acumulado de tokens de Anthropic y el costo estimado por pedido:
```bash
npx tsx scripts/calculate-costs.ts
```

---

## 📁 Estructura del Proyecto
- `/app`: Interfaz de usuario y rutas API (Next.js).
- `/lib/steps`: Lógica individual de los 8 pasos del pipeline.
- `/scripts`: Utilidades de automatización, costos y despliegue.
- `/lib/db.ts`: Gestión de base de datos local (SQLite).
- `.data/`: Carpeta persistente que contiene la DB y el historial de descargas (Sincronizada con la VM).

---

## 🛡️ Notas de Seguridad
- El sistema realiza un **Backup automático** de la base de datos antes de cada ejecución del pipeline.
- Todas las credenciales están protegidas en el archivo `.env` (No compartido en el repositorio).

---

Developed for **Tamaprint** | 2026
<!-- CI/CD Test: 2026-04-10 -->
