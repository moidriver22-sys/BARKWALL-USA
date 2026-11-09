import 'package:flutter/material.dart' hide Text;

import '../../../core/localization/bark_language.dart';
import 'shopper_route_qr_screen.dart';

class ShopperHomeScreen extends StatefulWidget {
  const ShopperHomeScreen({super.key});

  @override
  State<ShopperHomeScreen> createState() => _ShopperHomeScreenState();
}

class _ShopperHomeScreenState extends State<ShopperHomeScreen> {
  static const Color _primaryGreen = Color(0xFF1B4D3E);
  static const Color _darkBackground = Color(0xFF121212);
  static const Color _cardBackground = Color(0xFF1E1E1E);
  static const Color _accentGreen = Color(0xFF2ECC71);

  bool _isOnline = true;
  bool _isServiceActive = false;

  void _openRadar() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const ShopperRouteAndQRScreen()),
    );
  }

  void _toggleService() {
    if (!_isOnline) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('El servicio requiere conexión.')),
      );
      return;
    }
    setState(() => _isServiceActive = !_isServiceActive);
    final message = _isServiceActive
        ? 'Servicio iniciado para Max.'
        : 'Servicio finalizado.';
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _darkBackground,
      appBar: AppBar(
        backgroundColor: _primaryGreen,
        elevation: 0,
        title: const Row(
          children: [
            Icon(Icons.pets, color: Colors.white, size: 22),
            SizedBox(width: 8),
            Text(
              'BARKWALK',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
            ),
          ],
        ),
        actions: [
          Row(
            children: [
              Text(
                _isOnline ? 'EN LÍNEA' : 'OFFLINE',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: _isOnline ? _accentGreen : Colors.grey,
                ),
              ),
              Switch(
                value: _isOnline,
                activeThumbColor: _accentGreen,
                onChanged: (value) => setState(() => _isOnline = value),
              ),
            ],
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildMetricsRow(),
            const SizedBox(height: 22),
            const Text(
              'Siguiente Servicio',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            _buildNextTaskCard(),
            const SizedBox(height: 22),
            const Text(
              'Ruta del Día',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            _buildMapPreview(),
            const SizedBox(height: 76),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openRadar,
        backgroundColor: _primaryGreen,
        icon: const Icon(Icons.qr_code_scanner, color: Colors.white),
        label: const Text(
          'Escanear Kit',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ),
      ),
    );
  }

  Widget _buildMetricsRow() {
    return Row(
      children: [
        _buildMetricItem('Paseos Hoy', '4', Icons.directions_walk),
        const SizedBox(width: 8),
        _buildMetricItem('Ganancias', '\$85.00', Icons.attach_money),
        const SizedBox(width: 8),
        _buildMetricItem('Rating', '4.9 ★', Icons.star),
      ],
    );
  }

  Widget _buildMetricItem(String title, String value, IconData icon) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
        decoration: BoxDecoration(
          color: _cardBackground,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white10),
        ),
        child: Column(
          children: [
            Icon(icon, color: _accentGreen, size: 20),
            const SizedBox(height: 6),
            Text(
              value,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              title,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Colors.grey, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNextTaskCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBackground,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _primaryGreen, width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: _primaryGreen.withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text(
                    'PASEO + SUMINISTROS',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: _accentGreen,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              const Text(
                '10:30 AM',
                style: TextStyle(color: Colors.white70, fontSize: 13),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: _primaryGreen,
                child: Icon(Icons.pets, color: Colors.white),
              ),
              SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Max (Golden Retriever)',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Dueño: Carlos M. • Kit verificado',
                      style: TextStyle(color: Colors.grey, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: _isOnline ? _toggleService : null,
            style: FilledButton.styleFrom(
              backgroundColor: _primaryGreen,
              disabledBackgroundColor: Colors.grey.shade800,
              foregroundColor: Colors.white,
              minimumSize: const Size.fromHeight(45),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
            ),
            child: Text(
              _isServiceActive ? 'Finalizar Servicio' : 'Iniciar Servicio',
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMapPreview() {
    return Material(
      color: _cardBackground,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: _openRadar,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          height: 180,
          width: double.infinity,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white10),
          ),
          child: const Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.map_outlined, color: _accentGreen, size: 40),
              SizedBox(height: 8),
              Text(
                'Ver solicitudes y rutas',
                style: TextStyle(color: Colors.white70, fontSize: 13),
              ),
              SizedBox(height: 4),
              Icon(Icons.arrow_forward, color: Colors.white54, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}
