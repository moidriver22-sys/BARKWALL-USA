import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';

import '../../../core/localization/bark_language.dart';
import '../../../core/theme/bark_theme.dart';

class WalkerRadarScreen extends StatefulWidget {
  const WalkerRadarScreen({super.key});

  @override
  State<WalkerRadarScreen> createState() => _WalkerRadarScreenState();
}

class _WalkerRadarScreenState extends State<WalkerRadarScreen> {
  bool _isOnline = true;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Radar de paseos'),
        backgroundColor: BarkPalette.emerald,
        foregroundColor: Colors.white,
      ),
      body: Column(
        children: [
          Container(
            color: _isOnline ? const Color(0xFFE3F2EC) : Colors.grey.shade200,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Icon(
                  Icons.circle,
                  color: _isOnline ? BarkPalette.emerald : Colors.grey,
                  size: 12,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _isOnline ? 'Recibiendo solicitudes' : 'Desconectado',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                Switch(
                  value: _isOnline,
                  activeThumbColor: BarkPalette.emerald,
                  onChanged: (value) => setState(() => _isOnline = value),
                ),
              ],
            ),
          ),
          Expanded(
            child: _isOnline
                ? ListView(
                    padding: const EdgeInsets.all(16),
                    children: const [
                      OrderCard(
                        ownerName: 'Mary G.',
                        address: 'Birmingham, AL · 1.2 mi',
                        dogInfo: 'Max · Golden Retriever · 1 hora',
                        earnings: '\$40.00',
                        totalPrice: 'Tarifa total: \$50',
                      ),
                      SizedBox(height: 12),
                      OrderCard(
                        ownerName: 'John S.',
                        address: 'Birmingham, AL · 2.5 mi',
                        dogInfo: 'Luna · French Bulldog · 30 min',
                        earnings: '\$24.00',
                        totalPrice: 'Tarifa total: \$30',
                      ),
                    ],
                  )
                : const Center(
                    child: Text(
                      'Conéctate para ver solicitudes cercanas.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: BarkPalette.muted),
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class OrderCard extends StatelessWidget {
  const OrderCard({
    super.key,
    required this.ownerName,
    required this.address,
    required this.dogInfo,
    required this.earnings,
    required this.totalPrice,
  });

  final String ownerName;
  final String address;
  final String dogInfo;
  final String earnings;
  final String totalPrice;

  Future<void> _openAddress(BuildContext context) async {
    final uri = Uri.https('www.google.com', '/maps/search/', {
      'api': '1',
      'query': address,
    });
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('No se pudo abrir Maps.')));
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('No se pudo abrir Maps.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  ownerName,
                  style: const TextStyle(
                    color: BarkPalette.ink,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Text(
                earnings,
                style: const TextStyle(
                  color: BarkPalette.emerald,
                  fontSize: 21,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          Text(totalPrice, style: const TextStyle(color: BarkPalette.muted)),
          const Divider(height: 22),
          Row(
            children: [
              Expanded(
                child: _OrderDetail(
                  icon: Icons.location_on_outlined,
                  text: address,
                ),
              ),
              IconButton(
                tooltip: 'Abrir dirección en Maps',
                onPressed: () => _openAddress(context),
                icon: const Icon(Icons.map_outlined, color: BarkPalette.blue),
              ),
            ],
          ),
          const SizedBox(height: 8),
          _OrderDetail(icon: Icons.pets, text: dogInfo),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text(
                    'Solicitud aceptada. Contacta al dueño para coordinar.',
                  ),
                ),
              ),
              style: FilledButton.styleFrom(
                backgroundColor: BarkPalette.blue,
                foregroundColor: Colors.white,
              ),
              child: const Text('Aceptar paseo'),
            ),
          ),
        ],
      ),
    );
  }
}

class _OrderDetail extends StatelessWidget {
  const _OrderDetail({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 17, color: BarkPalette.blue),
        const SizedBox(width: 7),
        Expanded(
          child: Text(text, style: const TextStyle(color: BarkPalette.ink)),
        ),
      ],
    );
  }
}
