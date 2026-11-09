import 'package:flutter/material.dart' hide Text;
import 'package:url_launcher/url_launcher.dart';

import '../../../core/localization/bark_language.dart';
import '../../../core/models/walk_task.dart';

class ShopperRouteAndQRScreen extends StatefulWidget {
  const ShopperRouteAndQRScreen({super.key});

  @override
  State<ShopperRouteAndQRScreen> createState() =>
      _ShopperRouteAndQRScreenState();
}

class _ShopperRouteAndQRScreenState extends State<ShopperRouteAndQRScreen> {
  static const Color _primaryGreen = Color(0xFF1B4D3E);
  static const Color _darkBackground = Color(0xFF121212);
  static const Color _cardBackground = Color(0xFF1A1A1A);
  static const Color _accentGreen = Color(0xFF2ECC71);
  static const Color _subtleGreen = Color(0xFF132E25);

  final List<WalkTask> _assignedTasks = [
    WalkTask(
      id: 'TASK-001',
      petName: 'Max',
      ownerName: 'Carlos M.',
      address: '1800 29th Ave S, Homewood, AL',
      timeWindow: '10:00 AM - 10:45 AM',
      medicalAlerts: ['Alergia al pollo'],
      isInProgress: true,
    ),
    WalkTask(
      id: 'TASK-002',
      petName: 'Rocky',
      ownerName: 'Elena R.',
      address: '2820 18th St S, Homewood, AL',
      timeWindow: '11:15 AM - 12:00 PM',
      medicalAlerts: ['Sensibilidad en patas'],
    ),
    WalkTask(
      id: 'TASK-003',
      petName: 'Bella',
      ownerName: 'David L.',
      address: 'Central Ave, Homewood, AL',
      timeWindow: '01:00 PM - 01:45 PM',
      medicalAlerts: [],
    ),
  ];

  bool get _isEnglish => barkLanguage.value == BarkLanguage.english;
  int get _pendingCount =>
      _assignedTasks.where((task) => !task.isCompleted).length;

  Future<void> _openAddress(String address) async {
    final uri = Uri.https('www.google.com', '/maps/search/', {
      'api': '1',
      'query': address,
    });
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) _showMapsError();
    } catch (_) {
      if (mounted) _showMapsError();
    }
  }

  void _showMapsError() {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          _isEnglish ? 'Could not open Maps.' : 'No se pudo abrir Maps.',
        ),
      ),
    );
  }

  void _openQrDemo(WalkTask task) {
    final isFinishing = task.isInProgress;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: _cardBackground,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _isEnglish
                    ? 'QR scan simulation · ${task.petName}'
                    : 'Simulación de escaneo QR · ${task.petName}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _isEnglish
                    ? 'The camera scanner is not connected in this demo.'
                    : 'La cámara todavía no está conectada en esta demo.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white60, fontSize: 12),
              ),
              const SizedBox(height: 22),
              Container(
                height: 190,
                width: 190,
                decoration: BoxDecoration(
                  color: _darkBackground,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: _accentGreen, width: 2),
                ),
                child: const Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.qr_code_scanner, color: _accentGreen, size: 72),
                    SizedBox(height: 10),
                    Text(
                      'DEMO',
                      style: TextStyle(
                        color: Colors.white54,
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () {
                    Navigator.pop(sheetContext);
                    _applyDemoScan(task, isFinishing: isFinishing);
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: _primaryGreen,
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(48),
                  ),
                  icon: const Icon(Icons.check_circle_outline),
                  label: Text(
                    isFinishing
                        ? (_isEnglish
                              ? 'Simulate walk completion'
                              : 'Simular fin del paseo')
                        : (_isEnglish
                              ? 'Simulate QR scan'
                              : 'Simular lectura de QR'),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _applyDemoScan(WalkTask task, {required bool isFinishing}) {
    setState(() {
      if (isFinishing) {
        task.isInProgress = false;
        task.isCompleted = true;
      } else {
        task.isInProgress = true;
      }
    });

    final message = _isEnglish
        ? isFinishing
              ? 'Demo walk marked complete. No QR or GPS was verified.'
              : 'Demo walk started. No QR or GPS was verified.'
        : isFinishing
        ? 'Paseo demo marcado como terminado. No se verificó QR ni GPS.'
        : 'Paseo demo iniciado. No se verificó QR ni GPS.';
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final isEnglish = _isEnglish;
    return Scaffold(
      backgroundColor: _darkBackground,
      appBar: AppBar(
        backgroundColor: _primaryGreen,
        foregroundColor: Colors.white,
        title: Row(
          children: [
            const Icon(Icons.alt_route_rounded, color: _accentGreen, size: 22),
            const SizedBox(width: 10),
            Text(
              isEnglish ? 'SHOPPER ROUTE · DEMO' : 'RUTA SHOPPER · DEMO',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildRouteSummary(isEnglish),
          const SizedBox(height: 20),
          Text(
            isEnglish
                ? 'Upcoming stops · Homewood'
                : 'Próximas paradas · Homewood',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          for (final task in _assignedTasks) _buildTaskCard(task, isEnglish),
          const SizedBox(height: 8),
          Text(
            isEnglish
                ? 'Sample route only. No AI optimization or live GPS is connected.'
                : 'Ruta de ejemplo. No hay optimización con IA ni GPS en vivo conectado.',
            style: const TextStyle(color: Colors.white54, fontSize: 12),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteSummary(bool isEnglish) {
    final completedCount = _assignedTasks
        .where((task) => task.isCompleted)
        .length;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBackground,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white10),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isEnglish ? 'Route plan · demo' : 'Plan de ruta · demo',
                  style: const TextStyle(color: Colors.white60, fontSize: 12),
                ),
                const SizedBox(height: 4),
                Text(
                  isEnglish
                      ? '$completedCount completed · $_pendingCount remaining'
                      : '$completedCount completadas · $_pendingCount pendientes',
                  style: const TextStyle(
                    color: _accentGreen,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: _subtleGreen,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                const Icon(Icons.route_outlined, color: _accentGreen, size: 16),
                const SizedBox(width: 6),
                Text(
                  isEnglish ? 'Homewood' : 'Homewood',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTaskCard(WalkTask task, bool isEnglish) {
    final status = task.isCompleted
        ? (isEnglish ? 'COMPLETE' : 'COMPLETADO')
        : task.isInProgress
        ? (isEnglish ? 'IN PROGRESS' : 'EN PASEO')
        : (isEnglish ? 'UP NEXT' : 'PENDIENTE');
    final actionLabel = task.isCompleted
        ? (isEnglish ? 'Completed' : 'Completado')
        : task.isInProgress
        ? (isEnglish
              ? 'Scan to finish · demo'
              : 'Escanear para finalizar · demo')
        : (isEnglish
              ? 'Scan QR to start · demo'
              : 'Escanear QR para iniciar · demo');

    return Container(
      key: ValueKey(task.id),
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBackground,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: task.isInProgress ? _accentGreen : Colors.white10,
          width: task.isInProgress ? 1.5 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 18,
                backgroundColor: task.isInProgress
                    ? _accentGreen
                    : _primaryGreen,
                child: Icon(
                  task.isCompleted ? Icons.check : Icons.pets,
                  color: task.isInProgress ? _darkBackground : Colors.white,
                  size: 18,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${task.petName} · ${task.ownerName}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      task.timeWindow,
                      style: const TextStyle(
                        color: Colors.white54,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                status,
                style: TextStyle(
                  color: task.isCompleted ? Colors.white54 : _accentGreen,
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              const Icon(
                Icons.location_on_outlined,
                color: Colors.white54,
                size: 16,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  task.address,
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ),
              IconButton(
                tooltip: isEnglish
                    ? 'Open address in Maps'
                    : 'Abrir dirección en Maps',
                onPressed: () => _openAddress(task.address),
                icon: const Icon(Icons.map_outlined, color: _accentGreen),
              ),
            ],
          ),
          if (task.medicalAlerts.isNotEmpty) ...[
            const SizedBox(height: 4),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: task.medicalAlerts
                  .map(
                    (alert) => Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.amber.withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.warning_amber_rounded,
                            color: Colors.amber,
                            size: 14,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            alert,
                            style: const TextStyle(
                              color: Colors.amber,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  )
                  .toList(),
            ),
          ],
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: task.isCompleted ? null : () => _openQrDemo(task),
              style: FilledButton.styleFrom(
                backgroundColor: task.isInProgress
                    ? _primaryGreen
                    : _darkBackground,
                foregroundColor: Colors.white,
                disabledBackgroundColor: _subtleGreen,
                side: BorderSide(
                  color: task.isInProgress ? _primaryGreen : Colors.white24,
                ),
                minimumSize: const Size.fromHeight(42),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              icon: Icon(
                task.isCompleted ? Icons.check_circle : Icons.qr_code_scanner,
                color: task.isInProgress ? _accentGreen : Colors.white,
                size: 18,
              ),
              label: Text(
                actionLabel,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
