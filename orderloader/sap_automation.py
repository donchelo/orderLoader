#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAP Automation - Computer Vision Module
Automatización de SAP Business One usando pyautogui
"""

import time
import re
import pyautogui
from pathlib import Path
from typing import Optional, Tuple, Dict, Any
import logging


class SAPAutomation:
    """
    Automatización de SAP Business One con Computer Vision.

    Utiliza pyautogui para detectar elementos visuales en pantalla
    y automatizar la interacción con SAP.
    """

    def __init__(self, logger: logging.Logger, assets_path: Path, simulation_mode: bool = False):
        """
        Inicializar automatización SAP.

        Args:
            logger: Logger para registro de eventos
            assets_path: Ruta a las imágenes de referencia
            simulation_mode: Si True, simula acciones sin ejecutarlas
        """
        # Validación mínima de assets_path
        if not assets_path.exists():
            raise ValueError(f"Assets path no existe: {assets_path}")
        
        self.logger = logger
        self.assets_path = assets_path
        self.simulation_mode = simulation_mode
        self.confidence = 0.8  # Confidence por defecto
        self.timeout = 10  # Timeout por defecto

        # Validar configuración básica
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("Confidence debe estar entre 0.0 y 1.0")

        # Configurar pyautogui
        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0.5

        self.logger.info(f"🤖 SAPAutomation inicializado (Simulación: {simulation_mode})")

    def find_element(self, image_name: str, confidence: float = 0.8,
                     timeout: int = 10, region: Optional[Tuple] = None) -> Optional[Tuple]:
        """
        Buscar elemento en pantalla sin hacer clic.

        Args:
            image_name: Nombre del archivo de imagen relativo a assets_path
            confidence: Nivel de confianza de detección (0.0 - 1.0)
            timeout: Tiempo máximo de búsqueda en segundos
            region: Región de búsqueda (x, y, width, height) opcional

        Returns:
            Tuple con posición (x, y, width, height) o None si no se encuentra
        """
        image_path = self.assets_path / image_name

        if not image_path.exists():
            self.logger.error(f"❌ Imagen no encontrada: {image_path}")
            return None

        if self.simulation_mode:
            return (100, 100, 50, 50)  # Posición simulada

        self.logger.debug(f"🔍 Buscando: {image_name} (confidence={confidence})")
        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                location = pyautogui.locateOnScreen(
                    str(image_path),
                    confidence=confidence,
                    region=region
                )
                if location:
                    return location
            except pyautogui.ImageNotFoundException:
                pass
            except Exception as e:
                self.logger.debug(f"Error buscando {image_name}: {e}")

            time.sleep(0.5)

        return None

    def find_and_click(self, image_name: str, confidence: float = 0.8,
                       timeout: int = 10, region: Optional[Tuple] = None) -> bool:
        """
        Buscar imagen en pantalla y hacer clic.

        Args:
            image_name: Nombre del archivo de imagen relativo a assets_path
            confidence: Nivel de confianza de detección (0.0 - 1.0)
            timeout: Tiempo máximo de búsqueda en segundos
            region: Región de búsqueda (x, y, width, height) opcional

        Returns:
            bool: True si encontró y hizo clic exitosamente
        """
        # Modo simulación
        if self.simulation_mode:
            self.logger.info(f"🎭 [SIMULACIÓN] Click en {image_name}")
            time.sleep(0.5)
            return True

        location = self.find_element(image_name, confidence, timeout, region)
        if location:
            center = pyautogui.center(location)
            pyautogui.click(center)
            self.logger.info(f"✅ Click en {image_name} en posición {center}")
            return True

        self.logger.warning(f"⚠️ Timeout: No se encontró {image_name} después de {timeout}s")
        return False

    def type_text(self, text: str, interval: float = 0.05, press_enter: bool = False, 
                  clear_first: bool = False):
        """
        Escribir texto en el campo activo.

        Args:
            text: Texto a escribir
            interval: Intervalo entre teclas en segundos
            press_enter: Si True, presiona Enter al final
            clear_first: Si True, limpia el campo antes de escribir (Ctrl+A, Delete)
        """
        if self.simulation_mode:
            self.logger.info(f"🎭 [SIMULACIÓN] Escribiendo: {text}")
            time.sleep(0.3)
            return

        if clear_first:
            pyautogui.hotkey('ctrl', 'a')
            time.sleep(0.1)
            pyautogui.press('delete')
            time.sleep(0.1)

        pyautogui.write(str(text), interval=interval)
        self.logger.info(f"✍️ Texto escrito: {text}")

        if press_enter:
            pyautogui.press('enter')
            time.sleep(0.5)

    def press_key(self, key: str, times: int = 1):
        """
        Presionar una tecla.

        Args:
            key: Tecla a presionar ('enter', 'tab', 'esc', etc.)
            times: Número de veces a presionar
        """
        if self.simulation_mode:
            self.logger.info(f"🎭 [SIMULACIÓN] Presionando tecla: {key} x{times}")
            return

        for _ in range(times):
            pyautogui.press(key)
            time.sleep(0.2)

        self.logger.debug(f"⌨️ Tecla presionada: {key} x{times}")

    def wait_for_element(self, image_name: str, timeout: int = 5, 
                        confidence: float = 0.8) -> bool:
        """
        Esperar a que aparezca un elemento en pantalla.

        Args:
            image_name: Nombre del archivo de imagen
            timeout: Tiempo máximo de espera
            confidence: Nivel de confianza

        Returns:
            bool: True si el elemento apareció
        """
        return self.find_element(image_name, confidence, timeout) is not None

    def fill_date_field(self, date_str: str, field_image: Optional[str] = None) -> bool:
        """
        Rellenar un campo de fecha.

        Args:
            date_str: Fecha en formato DD/MM/YYYY o DD-MM-YYYY
            field_image: Imagen del campo (opcional, si no se proporciona usa Tab)

        Returns:
            bool: True si se rellenó exitosamente
        """
        if not date_str:
            return True

        # Validación mínima: formato DD/MM/YYYY o DD-MM-YYYY
        date_normalized = date_str.replace('-', '/')
        if not re.match(r'^\d{2}/\d{2}/\d{4}$', date_normalized):
            self.logger.error(f"❌ Fecha con formato inválido: {date_str} (esperado: DD/MM/YYYY o DD-MM-YYYY)")
            return False

        self.logger.info(f"📅 Rellenando fecha: {date_str}")

        if self.simulation_mode:
            self.logger.info(f"🎭 [SIMULACIÓN] Fecha: {date_str}")
            return True

        # Navegar al campo
        if field_image and (self.assets_path / field_image).exists():
            self.find_and_click(field_image, timeout=5)
        else:
            self.press_key('tab')

        time.sleep(0.3)

        # Escribir fecha normalizada
        self.type_text(date_normalized, clear_first=True, press_enter=True)
        time.sleep(0.5)

        self.logger.info(f"✅ Fecha {date_str} rellenada")
        return True

    def navigate_to_sales_order(self) -> bool:
        """
        Navegar al formulario de Orden de Venta en SAP.

        Secuencia:
        1. Click en menú "Módulos"
        2. Click en "Ventas"
        3. Click en "Orden de Venta"

        Returns:
            bool: True si la navegación fue exitosa
        """
        self.logger.info("🧭 Navegando a Orden de Venta...")

        # 1. Click en Módulos
        if not self.find_and_click("navegacion/menu_modulos.png", confidence=self.confidence, timeout=self.timeout):
            self.logger.error("❌ No se pudo abrir menú Módulos")
            return False
        time.sleep(1.5)

        # 2. Click en Ventas
        if not self.find_and_click("navegacion/menu_ventas.png", confidence=self.confidence, timeout=self.timeout):
            self.logger.error("❌ No se pudo abrir menú Ventas")
            return False
        time.sleep(1.5)

        # 3. Click en Orden de Venta (confidence más alto para evitar confusión con "Oferta de Ventas")
        if not self.find_and_click("navegacion/boton_orden_venta.png", confidence=0.85, timeout=self.timeout):
            self.logger.error("❌ No se pudo abrir Orden de Venta")
            return False
        time.sleep(2)  # Esperar que cargue el formulario

        self.logger.info("✅ Formulario de Orden de Venta abierto")
        return True

    def fill_customer(self, nit: str, nombre: str) -> bool:
        """
        Rellenar campo de cliente con NIT.

        Args:
            nit: NIT del cliente
            nombre: Nombre del cliente (para logging)

        Returns:
            bool: True si se rellenó exitosamente
        """
        # Validación mínima: no vacío y solo caracteres válidos
        if not nit or not nit.strip():
            self.logger.error("❌ NIT vacío")
            return False
        
        # Validar formato básico (números y guiones)
        nit_clean = nit.replace(' ', '')
        if not all(c.isdigit() or c == '-' for c in nit_clean):
            self.logger.error(f"❌ NIT con formato inválido: {nit} (solo números y guiones permitidos)")
            return False

        self.logger.info(f"👤 Rellenando cliente: {nit} - {nombre}")

        if self.simulation_mode:
            self.logger.info(f"🎭 [SIMULACIÓN] Cliente: {nit}")
            time.sleep(0.5)
            return True

        # Buscar campo cliente por imagen, si no existe usar Tab
        campo_cliente = "formularios/campo_cliente.png"
        if (self.assets_path / campo_cliente).exists():
            self.find_and_click(campo_cliente, timeout=5)
        else:
            self.press_key('tab')

        time.sleep(0.5)
        self.type_text(nit, clear_first=True, press_enter=True)
        time.sleep(1.5)  # Esperar que cargue el cliente

        # Verificar error solo si existe imagen
        error_cliente = "formularios/mensaje_error_cliente.png"
        if (self.assets_path / error_cliente).exists():
            if self.wait_for_element(error_cliente, timeout=2):
                self.logger.error(f"❌ Cliente {nit} no encontrado en SAP")
                return False

        self.logger.info(f"✅ Cliente {nit} seleccionado")
        return True

    def fill_order_header(self, order_data: Dict[str, Any]) -> bool:
        """
        Rellenar encabezado de la orden.

        Args:
            order_data: Diccionario con datos de la orden

        Returns:
            bool: True si se rellenó exitosamente
        """
        self.logger.info("📝 Rellenando encabezado de orden...")

        # Cliente (NIT)
        comprador = order_data.get('comprador', {})
        nit = comprador.get('nit')
        nombre = comprador.get('nombre', '')
        
        if not nit:
            self.logger.error("❌ NIT del cliente no proporcionado")
            return False

        if not self.fill_customer(nit, nombre):
            return False

        # Fecha de documento (opcional)
        fecha_doc = order_data.get('fecha_documento')
        if fecha_doc:
            campo_fecha_doc = "formularios/campo_fecha_documento.png"
            self.fill_date_field(fecha_doc, campo_fecha_doc if (self.assets_path / campo_fecha_doc).exists() else None)

        # Fecha de entrega (opcional)
        fecha_entrega = order_data.get('fecha_entrega')
        if fecha_entrega:
            campo_fecha_entrega = "formularios/campo_fecha_entrega.png"
            self.fill_date_field(fecha_entrega, campo_fecha_entrega if (self.assets_path / campo_fecha_entrega).exists() else None)

        self.logger.info("✅ Encabezado rellenado")
        return True

    def add_item(self, item: Dict[str, Any], item_number: int) -> bool:
        """
        Agregar un item a la orden.

        Args:
            item: Diccionario con datos del item
            item_number: Número de item (para logging)

        Returns:
            bool: True si se agregó exitosamente
        """
        codigo = item.get('codigo')
        descripcion = item.get('descripcion')
        cantidad = item.get('cantidad')
        precio = item.get('precio_unitario')

        if not codigo:
            self.logger.error(f"❌ Item {item_number}: código no proporcionado")
            return False

        if not cantidad:
            self.logger.error(f"❌ Item {item_number}: cantidad no proporcionada")
            return False

        self.logger.info(f"➕ Item {item_number}: {codigo} - Cant: {cantidad}")

        if self.simulation_mode:
            self.logger.info(f"🎭 [SIMULACIÓN] Item: {codigo} x {cantidad}")
            time.sleep(0.5)
            return True

        # Navegar al campo de código (si no es el primer item, usar Tab)
        if item_number > 1:
            self.press_key('tab', times=2)  # Nueva fila
        else:
            campo_codigo = "formularios/campo_codigo_item.png"
            if (self.assets_path / campo_codigo).exists():
                self.find_and_click(campo_codigo, timeout=3)
        
        time.sleep(0.3)

        # 1. Escribir código del item
        self.type_text(codigo, clear_first=True, press_enter=False)
        time.sleep(0.8)  # Esperar que SAP cargue el item

        # 2. Navegar a campo cantidad (Tab o Enter)
        self.press_key('tab')
        time.sleep(0.3)

        # 3. Escribir cantidad
        self.type_text(str(cantidad), clear_first=True, press_enter=False)
        time.sleep(0.5)

        # 4. Si hay precio personalizado, navegar y escribir
        if precio:
            self.press_key('tab')
            time.sleep(0.3)
            self.type_text(str(precio), clear_first=True, press_enter=False)
            time.sleep(0.3)

        # 5. Confirmar item (Enter o Tab para siguiente fila)
        self.press_key('enter')
        time.sleep(0.8)  # Esperar que se agregue el item

        self.logger.info(f"✅ Item {item_number} agregado")
        return True

    def save_order(self, order_number: str) -> bool:
        """
        Guardar la orden en SAP.

        Args:
            order_number: Número de orden (para logging)

        Returns:
            bool: True si se guardó exitosamente
        """
        self.logger.info(f"💾 Guardando orden {order_number}...")

        if self.simulation_mode:
            self.logger.info(f"🎭 [SIMULACIÓN] Orden {order_number} guardada")
            time.sleep(1)
            return True

        # Guardar: intentar botón, si no existe usar Ctrl+S
        boton_guardar = "formularios/boton_guardar.png"
        if (self.assets_path / boton_guardar).exists():
            self.find_and_click(boton_guardar, timeout=3)
        else:
            pyautogui.hotkey('ctrl', 's')

        time.sleep(2)

        # Verificar errores (si existe imagen de error)
        mensaje_error = "formularios/mensaje_error.png"
        if (self.assets_path / mensaje_error).exists():
            if self.wait_for_element(mensaje_error, timeout=2):
                self.logger.error("❌ Error detectado al guardar")
                self.take_debug_screenshot(f"error_guardado_{order_number}")
                self.press_key('enter')
                return False

        self.logger.info(f"✅ Orden {order_number} guardada exitosamente")
        return True

    def close_order_window(self) -> bool:
        """
        Cerrar ventana de orden actual.

        Returns:
            bool: True si se cerró exitosamente
        """
        if self.simulation_mode:
            self.logger.info("🎭 [SIMULACIÓN] Cerrando ventana de orden")
            time.sleep(0.3)
            return True

        # Intentar botón cerrar, si no existe usar Ctrl+W
        boton_cerrar = "formularios/boton_cerrar.png"
        if (self.assets_path / boton_cerrar).exists():
            self.find_and_click(boton_cerrar, timeout=2)
        else:
            pyautogui.hotkey('ctrl', 'w')

        time.sleep(0.5)
        self.logger.info("✅ Ventana de orden cerrada")
        return True

    def process_order(self, order_data: Dict[str, Any]) -> bool:
        """
        Procesar una orden completa en SAP.

        Este es el método principal que orquesta todo el proceso:
        1. Navegar a Orden de Venta
        2. Rellenar encabezado
        3. Agregar todos los items
        4. Guardar orden
        5. Cerrar ventana

        Args:
            order_data: Diccionario completo con datos de la orden

        Returns:
            bool: True si la orden se procesó exitosamente
        """
        orden_compra = order_data.get('orden_compra', 'N/A')
        items = order_data.get('items', [])

        if not items:
            self.logger.error("❌ La orden no tiene items")
            return False

        self.logger.info(f"🎯 Procesando orden: {orden_compra} ({len(items)} items)")

        ventana_abierta = False
        try:
            # 1. Navegar a Orden de Venta
            if not self.navigate_to_sales_order():
                self.logger.error("❌ Fallo en navegación")
                self.take_debug_screenshot(f"error_navegacion_{orden_compra}")
                return False
            ventana_abierta = True

            # 2. Rellenar encabezado
            if not self.fill_order_header(order_data):
                self.logger.error("❌ Fallo rellenando encabezado")
                self.take_debug_screenshot(f"error_encabezado_{orden_compra}")
                return False

            # 3. Agregar items
            for idx, item in enumerate(items, 1):
                if not self.add_item(item, idx):
                    self.logger.error(f"❌ Fallo agregando item {idx}: {item.get('codigo')}")
                    self.take_debug_screenshot(f"error_item_{idx}_{orden_compra}")
                    return False

            # 4. Guardar orden
            if not self.save_order(orden_compra):
                self.logger.error("❌ Fallo guardando orden")
                self.take_debug_screenshot(f"error_guardado_{orden_compra}")
                return False

            # 5. Cerrar ventana
            self.close_order_window()
            ventana_abierta = False

            self.logger.info(f"🎉 Orden {orden_compra} procesada exitosamente!")
            return True

        except KeyboardInterrupt:
            self.logger.warning("⚠️ Proceso interrumpido por el usuario")
            self.take_debug_screenshot(f"interrumpido_{orden_compra}")
            return False
        except Exception as e:
            self.logger.error(f"❌ Error crítico procesando orden {orden_compra}: {e}")
            self.logger.error(f"   Detalles: {type(e).__name__} - {str(e)}")
            self.take_debug_screenshot(f"error_critico_{orden_compra}")
            return False
        finally:
            # Solo cerrar si se abrió ventana
            if ventana_abierta:
                self.close_order_window()

    def take_debug_screenshot(self, name: str = "debug"):
        """
        Tomar screenshot para debugging.

        Args:
            name: Nombre del archivo (sin extensión)
        """
        if self.simulation_mode:
            return

        try:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            screenshot_path = self.assets_path.parent.parent / f"debug_{name}_{timestamp}.png"
            pyautogui.screenshot(str(screenshot_path))
            self.logger.info(f"📸 Screenshot guardado: {screenshot_path}")
        except Exception as e:
            self.logger.warning(f"⚠️ Error guardando screenshot: {e}")
