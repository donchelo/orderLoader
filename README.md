# OrderLoader 2.0

Sistema de automatización para crear órdenes de venta en SAP Business One usando Computer Vision (pyautogui). Procesa archivos JSON de órdenes de compra, valida datos, crea backups automáticos y automatiza la creación de órdenes en SAP mediante reconocimiento de imágenes.

---

## Instalación

```bash
# 1. Clonar repositorio
git clone https://github.com/donchelo/orderloader2.0.git
cd orderloader2.0

# 2. Crear entorno virtual
py -3 -m venv venv
.\venv\Scripts\activate

# 3. Instalar dependencias
pip install -r orderloader/requirements.txt
```

---

## Uso

### Ejecutar Tests de Validación
```bash
cd orderloader
py -m unittest tests.test_validations
```
**Tests implementados:**
- Validación de NIT (6 tests)
- Validación de fechas (6 tests)
- Validación de items (4 tests)
- Validación de configuración (1 test)

**Total: 17 tests**

### Ejecutar Sistema
```bash
cd orderloader
py main.py
```

**Requisitos:**
- SAP Business One abierto en Chrome (ventana accesible con Alt+Tab)
- Archivos JSON en `orderloader/data/pending/`
- Imágenes de navegación en `orderloader/assets/images/sap/navegacion/` (3 imágenes requeridas)

**Nota:** Si `simulation_mode: True`, no se requiere SAP abierto (solo para pruebas).

---

## Estructura del Proyecto

```
orderloader2.0/
├── orderloader/
│   ├── main.py                  # Orquestador principal (OrderLoader)
│   ├── config.py                # Configuración centralizada
│   ├── sap_automation.py        # Módulo Computer Vision (SAPAutomation)
│   ├── requirements.txt         # Dependencias
│   │
│   ├── data/
│   │   ├── pending/             # JSON a procesar
│   │   └── completed/           # JSON procesados exitosamente
│   │
│   ├── backups/                 # Backups automáticos comprimidos (.gz)
│   ├── logs/                    # Logs diarios (orderloader_YYYYMMDD.log)
│   │
│   ├── assets/images/sap/
│   │   ├── navegacion/          # Imágenes de navegación (3)
│   │   ├── formulario/          # Campos del formulario (opcional)
│   │   ├── items/               # Tabla de items (opcional)
│   │   └── acciones/            # Botones de acción (opcional)
│   │
│   └── tests/
│       └── test_validations.py  # Tests de validaciones críticas
│
└── venv/                        # Entorno virtual (ignorado en Git)
```

---

## Formato JSON de Órdenes

```json
{
  "orden_compra": "TEST001",
  "fecha_documento": "01/10/2025",
  "fecha_entrega": "15/10/2025",
  "comprador": {
    "nit": "900123456",
    "nombre": "EMPRESA DE PRUEBA S.A.S."
  },
  "items": [
    {
      "codigo": "PROD001",
      "descripcion": "PRODUCTO DE PRUEBA 1",
      "cantidad": 100,
      "precio_unitario": 1500,
      "precio_total": 150000,
      "fecha_entrega": "15/10/2025"
    }
  ],
  "valor_total": 150000,
  "total_items_unicos": 1,
  "numero_items_totales": 100
}
```

Coloca los JSON en `orderloader/data/pending/` y el sistema los procesará automáticamente.

---

## Configuración

Edita `orderloader/config.py`:

```python
# Configuración de automatización SAP
SAP_AUTOMATION_CONFIG = {
    'simulation_mode': True,      # True = simular, False = automatización real
    'confidence': 0.8,            # Nivel de confianza para detección (0.0 - 1.0)
    'search_timeout': 10,         # Timeout de búsqueda de imágenes (segundos)
    'type_interval': 0.05,        # Intervalo entre teclas al escribir
    'action_delay': 0.5,          # Delay entre acciones (segundos)
}

# Configuración de retry
RETRY_CONFIG = {
    'max_attempts': 3,            # Intentos máximos
    'base_delay': 1.0,           # Delay inicial (segundos)
    'max_delay': 10.0,           # Delay máximo (segundos)
    'backoff_multiplier': 2.0,   # Multiplicador exponencial
}

# Configuración de backup
BACKUP_CONFIG = {
    'enabled': True,             # Habilitar backups
    'backup_path': 'backups',     # Directorio de backups
    'max_backups': 10,           # Máximo de backups a mantener
    'compress_backups': True,     # Comprimir backups (.gz)
}

# Configuración de métricas
METRICS_CONFIG = {
    'enabled': True,             # Habilitar métricas
    'metrics_file': 'metrics.json'  # Archivo de métricas
}
```

---

## Flujo del Sistema

### Proceso Completo

1. **Inicialización**
   - Valida permisos del sistema
   - Crea directorios necesarios (pending/, completed/, backups/, logs/)
   - Inicializa componentes (WindowManager, FileProcessor, QueueManager, MetricsCollector)

2. **Configuración de Entorno SAP**
   - Activa ventana de SAP en Chrome (Alt+Tab con retry automático)
   - Maximiza ventana (Win+Up)
   - Verifica que SAP esté visible (opcional)

3. **Procesamiento de Cola**
   - Para cada archivo JSON en `pending/`:
     - **Validación JSON**: Estructura, campos requeridos, tipos de datos
     - **Backup automático**: Crea backup comprimido antes de procesar
     - **Procesamiento en SAP**:
       - Navega a Orden de Venta (Computer Vision)
       - Rellena datos del cliente (NIT con validación)
       - Rellena fechas (validación de formato)
       - Agrega items (validación de código y cantidad)
       - Guarda orden
       - Cierra ventana (cleanup garantizado en errores)
     - **Mover a completed/**: Solo si el procesamiento fue exitoso

4. **Finalización**
   - Limpia backups antiguos (mantiene solo los más recientes)
   - Guarda métricas de rendimiento
   - Reporta tasa de éxito

---

## Arquitectura

### Componentes Principales

```python
OrderLoader (Orquestador Principal)
├── WindowManager
│   ├── activate_sap_chrome_window()  # Alt+Tab con retry
│   ├── maximize_window()             # Win+Up
│   └── verify_sap_chrome()           # Verificación opcional
│
├── FileProcessor
│   ├── validate_json()               # Validación de estructura JSON
│   ├── create_backup()               # Backup comprimido automático
│   └── process_json()                # Procesa orden en SAP
│
├── QueueManager
│   ├── get_pending_files()           # Lista archivos pendientes
│   ├── process_queue()               # Procesa cola completa
│   └── move_to_completed()           # Mueve archivos exitosos
│
├── MetricsCollector
│   ├── start_session()               # Inicia sesión de métricas
│   ├── record_file_processed()      # Registra archivo procesado
│   └── get_success_rate()            # Calcula tasa de éxito
│
└── SAPAutomation (Computer Vision)
    ├── navigate_to_sales_order()     # Navega a Orden de Venta
    ├── fill_customer()                # Rellena NIT (con validación)
    ├── fill_date_field()              # Rellena fechas (con validación)
    ├── add_item()                    # Agrega items (con validación)
    ├── save_order()                  # Guarda orden
    ├── close_order_window()          # Cierra ventana
    └── process_order()               # Orquesta proceso completo
```

### Características de Seguridad

- **Cleanup garantizado**: Bloque `finally` asegura cierre de ventana en errores
- **Validaciones críticas**: NIT, fechas, items antes de procesar
- **Sistema de retry**: Backoff exponencial para operaciones críticas
- **Backups automáticos**: Comprimidos (.gz) antes de procesar
- **Screenshots de debug**: Captura automática en errores de Computer Vision

---

## Computer Vision

### Imágenes de Navegación (Requeridas)
- `navegacion/menu_modulos.png` - Botón "Módulos"
- `navegacion/menu_ventas.png` - Menú "Ventas"
- `navegacion/boton_orden_venta.png` - "Orden de Venta"

### Imágenes Opcionales (Fallback a Tab/Enter)
- `formularios/campo_cliente.png` - Campo de cliente (si no existe, usa Tab)
- `formularios/campo_fecha_documento.png` - Campo fecha documento
- `formularios/campo_fecha_entrega.png` - Campo fecha entrega
- `formularios/campo_codigo_item.png` - Campo código de item
- `formularios/boton_guardar.png` - Botón guardar (si no existe, usa Ctrl+S)
- `formularios/boton_cerrar.png` - Botón cerrar (si no existe, usa Ctrl+W)
- `formularios/mensaje_error_cliente.png` - Mensaje de error de cliente
- `formularios/mensaje_error.png` - Mensaje de error general

### Capturar Nuevas Imágenes
1. Abre SAP maximizado
2. Usa Win+Shift+S para capturar pantalla
3. Recorta solo el botón/campo (incluye 5-10px alrededor para contexto)
4. Guarda en `orderloader/assets/images/sap/[carpeta]/`
5. Usa nombres descriptivos y consistentes

**Nota**: Si una imagen no existe, el sistema usa métodos alternativos (Tab, Enter, atajos de teclado).

---

## Validaciones Implementadas

### Validación de NIT
- ✅ No vacío
- ✅ Solo números y guiones permitidos
- ✅ Verificación de error de cliente (si existe imagen de error)

### Validación de Fechas
- ✅ Formato DD/MM/YYYY o DD-MM-YYYY
- ✅ Rechaza formatos incorrectos (YYYY-MM-DD, etc.)
- ✅ Fechas vacías son opcionales (retorna True)

### Validación de Items
- ✅ Orden debe tener al menos un item
- ✅ Item debe tener código
- ✅ Item debe tener cantidad

### Validación de Configuración
- ✅ Assets path debe existir
- ✅ Confidence debe estar entre 0.0 y 1.0

---

## Tests Unitarios

### Tests de Validación (17 tests)

**Validación de NIT (6 tests):**
- ✅ NIT válido (números)
- ✅ NIT válido con guión
- ❌ NIT vacío
- ❌ NIT solo espacios
- ❌ NIT con letras
- ❌ NIT con caracteres especiales

**Validación de Fechas (6 tests):**
- ✅ Fecha DD/MM/YYYY válida
- ✅ Fecha DD-MM-YYYY válida
- ❌ Fecha formato incorrecto (YYYY-MM-DD)
- ❌ Fecha sin separadores
- ❌ Fecha con año corto
- ✅ Fecha vacía (opcional)

**Validación de Items (4 tests):**
- ❌ Orden sin items
- ❌ Item sin código
- ❌ Item sin cantidad
- ✅ Item válido

**Validación de Configuración (1 test):**
- ❌ Assets path inexistente lanza error

### Ejecutar Tests
```bash
cd orderloader
py -m unittest tests.test_validations -v
```

---

## Importante: Flujo PowerShell

El sistema se ejecuta desde PowerShell, por lo tanto:
- PowerShell está activo al inicio
- **Alt+Tab automático** cambia a Chrome/SAP
- **No tocar** teclado/mouse durante ejecución

Esto está implementado en `WindowManager.activate_sap_chrome_window()`.

---

## Logs y Debug

### Archivos Generados

```
orderloader/
├── logs/
│   └── orderloader_YYYYMMDD.log    # Logs detallados con timestamps
├── backups/
│   └── *.gz                         # Backups comprimidos automáticos
├── metrics.json                     # Métricas de rendimiento (JSON)
└── debug_*.png                      # Screenshots automáticos en errores
```

### Niveles de Log

- **INFO**: Operaciones normales (procesamiento, navegación, guardado)
- **WARNING**: Advertencias (SAP no detectado, backup fallido)
- **ERROR**: Errores críticos (validación fallida, procesamiento fallido)
- **DEBUG**: Detalles técnicos (búsqueda de imágenes, timeouts)

### Screenshots de Debug

El sistema captura automáticamente screenshots cuando:
- Falla la navegación a Orden de Venta
- Falla el rellenado del encabezado
- Falla el agregado de un item
- Falla el guardado de la orden
- Ocurre un error crítico

Los screenshots se guardan como `debug_[tipo]_[orden]_[timestamp].png`

---

## Características Principales

### ✅ Implementado

- **Computer Vision**: Automatización usando pyautogui con detección de imágenes
- **Validaciones críticas**: NIT, fechas, items antes de procesar
- **Sistema de retry**: Backoff exponencial para operaciones críticas
- **Backups automáticos**: Comprimidos (.gz) antes de procesar
- **Cleanup garantizado**: Bloque `finally` asegura cierre de ventana en errores
- **Métricas de rendimiento**: Tasa de éxito, tiempos de procesamiento
- **Logging detallado**: Logs diarios con diferentes niveles
- **Screenshots de debug**: Captura automática en errores
- **Modo simulación**: Permite probar sin interactuar con SAP real
- **Tests de validación**: 17 tests para validaciones críticas

### 🔄 Modo Simulación vs Producción

**Modo Simulación** (`simulation_mode: True`):
- Simula todas las acciones sin interactuar con SAP
- Útil para probar validaciones y flujo de datos
- No requiere SAP abierto

**Modo Producción** (`simulation_mode: False`):
- Interactúa con SAP real usando Computer Vision
- Requiere SAP abierto en Chrome
- Requiere imágenes de referencia capturadas

---

## Códigos de Error

### Errores de Sistema
| Código | Descripción |
|--------|-------------|
| SYS001 | Error de validación del sistema |
| SYS002 | Permiso denegado |
| SYS003 | Error creando directorio |

### Errores de Ventana
| Código | Descripción |
|--------|-------------|
| WIN001 | Error activando ventana (Alt+Tab) |
| WIN002 | Error maximizando ventana (Win+Up) |
| WIN003 | SAP no detectado |

### Errores de Archivos
| Código | Descripción |
|--------|-------------|
| FILE001 | Archivo no encontrado |
| FILE002 | Error validando JSON |
| FILE003 | Error procesando JSON |
| FILE004 | Error moviendo archivo |

### Errores de Red/Sistema
| Código | Descripción |
|--------|-------------|
| NET001 | Timeout de PowerShell |
| NET002 | Error en subproceso |

---

## Estado del Proyecto

**Versión:** 2.0.1  
**Estado:** ✅ MVP Producción - Validaciones y Robustez Implementadas

### Funcionalidades Completadas

- ✅ Validación de formato NIT
- ✅ Validación de formato de fechas
- ✅ Verificación de error de cliente (opcional)
- ✅ Cleanup garantizado en errores (finally block)
- ✅ Validación de assets_path y confidence
- ✅ Tests de validaciones (17 tests)
- ✅ Sistema de retry con backoff exponencial
- ✅ Backups automáticos comprimidos
- ✅ Métricas de rendimiento
- ✅ Screenshots de debug automáticos

---

## Changelog

### 2.0.1 (2025-10-01)
- ✅ Validaciones críticas implementadas (NIT, fechas, items)
- ✅ Cleanup garantizado en errores (finally block)
- ✅ Tests de validación (17 tests)
- ✅ Validación de configuración al inicio
- ✅ Sistema de retry con backoff exponencial
- ✅ Backups automáticos comprimidos (.gz)
- ✅ Screenshots de debug automáticos
- ✅ Reestructuración completa
- ✅ Documentación actualizada

### 2.0.0 (2024-01-15)
- Arquitectura modular
- Sistema de retry automático
- Backup automático
- Métricas de rendimiento

---

## Dependencias

El proyecto utiliza las siguientes dependencias:

```txt
pyautogui==0.9.54          # Computer Vision y automatización de interfaz
psutil==5.9.5              # Gestión de procesos del sistema
Pillow>=10.0.0             # Procesamiento de imágenes (requerido por pyautogui)
opencv-python>=4.0.0       # Detección de imágenes con confidence (requerido por pyautogui)
```

**Instalación:**
```bash
cd orderloader
pip install -r requirements.txt
```

---

## Licencia

Proyecto privado - OrderLoader System © 2024-2025
