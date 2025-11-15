#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tests mínimos para validaciones críticas de OrderLoader 2.0
"""

import unittest
import logging
from pathlib import Path
from unittest.mock import Mock, MagicMock, patch

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from sap_automation import SAPAutomation


class TestNITValidation(unittest.TestCase):
    """Tests para validación de NIT"""

    def setUp(self):
        """Configurar test"""
        self.logger = logging.getLogger('test')
        self.logger.setLevel(logging.ERROR)  # Solo errores para tests
        self.assets_path = Path(__file__).parent.parent / "assets" / "images" / "sap"
        self.assets_path.mkdir(parents=True, exist_ok=True)
        
        # Crear SAPAutomation en modo simulación
        self.sap = SAPAutomation(
            logger=self.logger,
            assets_path=self.assets_path,
            simulation_mode=True
        )

    def test_nit_valido(self):
        """Test que NIT válido pasa la validación"""
        result = self.sap.fill_customer("900123456", "Test Cliente")
        self.assertTrue(result, "NIT válido debería pasar")

    def test_nit_valido_con_guion(self):
        """Test que NIT con guión pasa la validación"""
        result = self.sap.fill_customer("900-123-456", "Test Cliente")
        self.assertTrue(result, "NIT con guión debería pasar")

    def test_nit_vacio(self):
        """Test que NIT vacío falla"""
        result = self.sap.fill_customer("", "Test Cliente")
        self.assertFalse(result, "NIT vacío debería fallar")

    def test_nit_solo_espacios(self):
        """Test que NIT con solo espacios falla"""
        result = self.sap.fill_customer("   ", "Test Cliente")
        self.assertFalse(result, "NIT con solo espacios debería fallar")

    def test_nit_invalido_con_letras(self):
        """Test que NIT con letras falla"""
        result = self.sap.fill_customer("ABC123456", "Test Cliente")
        self.assertFalse(result, "NIT con letras debería fallar")

    def test_nit_invalido_con_caracteres_especiales(self):
        """Test que NIT con caracteres especiales falla"""
        result = self.sap.fill_customer("900.123.456", "Test Cliente")
        self.assertFalse(result, "NIT con puntos debería fallar")


class TestDateValidation(unittest.TestCase):
    """Tests para validación de fechas"""

    def setUp(self):
        """Configurar test"""
        self.logger = logging.getLogger('test')
        self.logger.setLevel(logging.ERROR)
        self.assets_path = Path(__file__).parent.parent / "assets" / "images" / "sap"
        self.assets_path.mkdir(parents=True, exist_ok=True)
        
        self.sap = SAPAutomation(
            logger=self.logger,
            assets_path=self.assets_path,
            simulation_mode=True
        )

    def test_fecha_valida_dd_mm_yyyy(self):
        """Test que fecha DD/MM/YYYY válida pasa"""
        result = self.sap.fill_date_field("01/10/2025")
        self.assertTrue(result, "Fecha DD/MM/YYYY debería pasar")

    def test_fecha_valida_dd_mm_yyyy_con_guion(self):
        """Test que fecha DD-MM-YYYY válida pasa"""
        result = self.sap.fill_date_field("01-10-2025")
        self.assertTrue(result, "Fecha DD-MM-YYYY debería pasar")

    def test_fecha_invalida_formato_incorrecto(self):
        """Test que fecha con formato incorrecto falla"""
        result = self.sap.fill_date_field("2025-10-01")
        self.assertFalse(result, "Fecha YYYY-MM-DD debería fallar")

    def test_fecha_invalida_sin_separadores(self):
        """Test que fecha sin separadores falla"""
        result = self.sap.fill_date_field("01102025")
        self.assertFalse(result, "Fecha sin separadores debería fallar")

    def test_fecha_invalida_corta(self):
        """Test que fecha muy corta falla"""
        result = self.sap.fill_date_field("01/10/25")
        self.assertFalse(result, "Fecha con año corto debería fallar")

    def test_fecha_vacia(self):
        """Test que fecha vacía retorna True (opcional)"""
        result = self.sap.fill_date_field("")
        self.assertTrue(result, "Fecha vacía es opcional y debería pasar")


class TestItemsValidation(unittest.TestCase):
    """Tests para validación de items"""

    def setUp(self):
        """Configurar test"""
        self.logger = logging.getLogger('test')
        self.logger.setLevel(logging.ERROR)
        self.assets_path = Path(__file__).parent.parent / "assets" / "images" / "sap"
        self.assets_path.mkdir(parents=True, exist_ok=True)
        
        self.sap = SAPAutomation(
            logger=self.logger,
            assets_path=self.assets_path,
            simulation_mode=True
        )

    def test_orden_sin_items(self):
        """Test que orden sin items falla"""
        order_data = {
            'orden_compra': 'TEST001',
            'items': []
        }
        result = self.sap.process_order(order_data)
        self.assertFalse(result, "Orden sin items debería fallar")

    def test_item_sin_codigo(self):
        """Test que item sin código falla"""
        item = {
            'cantidad': 10,
            'precio_unitario': 1000
        }
        result = self.sap.add_item(item, 1)
        self.assertFalse(result, "Item sin código debería fallar")

    def test_item_sin_cantidad(self):
        """Test que item sin cantidad falla"""
        item = {
            'codigo': 'PROD001',
            'precio_unitario': 1000
        }
        result = self.sap.add_item(item, 1)
        self.assertFalse(result, "Item sin cantidad debería fallar")

    def test_item_valido(self):
        """Test que item válido pasa"""
        item = {
            'codigo': 'PROD001',
            'cantidad': 10,
            'precio_unitario': 1000
        }
        result = self.sap.add_item(item, 1)
        self.assertTrue(result, "Item válido debería pasar")


class TestConfigurationValidation(unittest.TestCase):
    """Tests para validación de configuración"""

    def test_assets_path_no_existe(self):
        """Test que assets_path inexistente lanza error"""
        logger = logging.getLogger('test')
        assets_path = Path("/ruta/inexistente")
        
        with self.assertRaises(ValueError):
            SAPAutomation(
                logger=logger,
                assets_path=assets_path,
                simulation_mode=True
            )


if __name__ == '__main__':
    unittest.main()

