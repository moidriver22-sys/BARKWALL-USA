import 'dart:async';

import 'package:flutter/material.dart' hide Text;
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/localization/bark_language.dart';
import '../../../core/theme/bark_theme.dart';

class OwnerTrackingScreen extends StatefulWidget {
  const OwnerTrackingScreen({super.key});

  @override
  State<OwnerTrackingScreen> createState() => _OwnerTrackingScreenState();
}

class _OwnerTrackingScreenState extends State<OwnerTrackingScreen> {
  static const _walkerPhone = '+12025550144';
  static const _walkDuration = Duration(hours: 1);

  Position? _position;
  StreamSubscription<Position>? _positionSubscription;
  Timer? _timer;
  Duration _elapsed = Duration.zero;
  bool _isTracking = false;
  bool _isLoadingLocation = false;
  String _locationStatus = 'Seguimiento detenido';

  @override
  void dispose() {
    _timer?.cancel();
    _positionSubscription?.cancel();
    super.dispose();
  }

  Future<void> _toggleTracking() async {
    if (_isTracking) {
      await _stopTracking();
      return;
    }

    setState(() {
      _isLoadingLocation = true;
      _locationStatus = 'Solicitando acceso al GPS...';
    });

    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        _setLocationUnavailable(
          'Activa los servicios de ubicación del dispositivo.',
        );
        return;
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        _setLocationUnavailable(
          'Permite el acceso a la ubicación para iniciar.',
        );
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      if (!mounted) return;

      _position = position;
      _positionSubscription =
          Geolocator.getPositionStream(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              distanceFilter: 10,
            ),
          ).listen(
            (nextPosition) {
              if (!mounted) return;
              setState(() {
                _position = nextPosition;
                _locationStatus = 'GPS activo en este dispositivo';
              });
            },
            onError: (_) {
              if (mounted) {
                setState(() => _locationStatus = 'Se perdió la señal GPS');
              }
            },
          );
      setState(() {
        _isTracking = true;
        _isLoadingLocation = false;
        _locationStatus = 'GPS activo en este dispositivo';
      });
      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() => _elapsed += const Duration(seconds: 1));
      });
    } catch (_) {
      _setLocationUnavailable(
        'No se pudo obtener la ubicación. Inténtalo de nuevo.',
      );
    }
  }

  Future<void> _stopTracking() async {
    _timer?.cancel();
    _timer = null;
    await _positionSubscription?.cancel();
    _positionSubscription = null;
    if (!mounted) return;
    setState(() {
      _isTracking = false;
      _locationStatus = 'Seguimiento detenido';
    });
  }

  void _setLocationUnavailable(String message) {
    if (!mounted) return;
    setState(() {
      _isLoadingLocation = false;
      _locationStatus = message;
    });
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _openExternal(Uri uri, String unavailableMessage) async {
    try {
      final launched = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );
      if (!launched && mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(unavailableMessage)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(unavailableMessage)));
      }
    }
  }

  Future<void> _openMaps() async {
    final position = _position;
    if (position == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Inicia el GPS para compartir una ubicación.'),
        ),
      );
      return;
    }
    final uri = Uri.https('www.google.com', '/maps/search/', {
      'api': '1',
      'query': '${position.latitude},${position.longitude}',
    });
    await _openExternal(uri, 'No se pudo abrir Maps.');
  }

  Future<void> _callWalker() => _openExternal(
    Uri(scheme: 'tel', path: _walkerPhone),
    'No hay una aplicación de llamadas disponible.',
  );

  Future<void> _messageWalker() => _openExternal(
    Uri(
      scheme: 'sms',
      path: _walkerPhone,
      queryParameters: {'body': 'Hola, ¿cómo va el paseo de Max?'},
    ),
    'No hay una aplicación de mensajes disponible.',
  );

  String get _formattedElapsed {
    final hours = _elapsed.inHours.toString().padLeft(2, '0');
    final minutes = (_elapsed.inMinutes % 60).toString().padLeft(2, '0');
    final seconds = (_elapsed.inSeconds % 60).toString().padLeft(2, '0');
    return '$hours:$minutes:$seconds';
  }

  Duration get _remainingTime =>
      _elapsed >= _walkDuration ? Duration.zero : _walkDuration - _elapsed;

  String get _formattedRemaining => '${_remainingTime.inMinutes} min';

  @override
  Widget build(BuildContext context) {
    final position = _position;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Seguimiento del paseo'),
        backgroundColor: BarkPalette.emerald,
        foregroundColor: Colors.white,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        children: [
          _WalkerSummary(onCall: _callWalker, onMessage: _messageWalker),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.circle,
                      size: 12,
                      color: _isTracking ? BarkPalette.emerald : Colors.grey,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _locationStatus,
                        style: const TextStyle(
                          color: BarkPalette.ink,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 22),
                const Text(
                  'PASEADOR: ALEX M.',
                  style: TextStyle(
                    color: BarkPalette.ink,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 12),
                LinearProgressIndicator(
                  value: (_elapsed.inSeconds / _walkDuration.inSeconds).clamp(
                    0.0,
                    1.0,
                  ),
                  minHeight: 9,
                  borderRadius: BorderRadius.circular(8),
                  backgroundColor: const Color(0xFFE7ECEB),
                  color: BarkPalette.emerald,
                ),
                const SizedBox(height: 8),
                Text(
                  'Tiempo restante: $_formattedRemaining',
                  style: const TextStyle(
                    color: BarkPalette.emerald,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  'TIEMPO DE PASEO',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: BarkPalette.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _formattedElapsed,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: BarkPalette.ink,
                    fontSize: 40,
                    fontWeight: FontWeight.w700,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
                const SizedBox(height: 18),
                FilledButton.icon(
                  onPressed: _isLoadingLocation ? null : _toggleTracking,
                  icon: _isLoadingLocation
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Icon(_isTracking ? Icons.stop : Icons.my_location),
                  label: Text(
                    _isLoadingLocation
                        ? 'Buscando GPS...'
                        : _isTracking
                        ? 'Detener seguimiento'
                        : 'Iniciar seguimiento',
                  ),
                  style: FilledButton.styleFrom(
                    backgroundColor: _isTracking
                        ? BarkPalette.blue
                        : BarkPalette.emerald,
                    padding: const EdgeInsets.symmetric(vertical: 15),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Ubicación',
                  style: TextStyle(
                    color: BarkPalette.ink,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 14),
                Container(
                  height: 142,
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: const Color(0xFFEAF2F4),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(
                        Icons.location_on,
                        color: BarkPalette.blue,
                        size: 34,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        position == null
                            ? 'La ubicación aparecerá al iniciar el GPS'
                            : '${position.latitude.toStringAsFixed(5)}, '
                                  '${position.longitude.toStringAsFixed(5)}',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: BarkPalette.ink),
                      ),
                      if (position != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          'Precisión: ${position.accuracy.round()} m',
                          style: const TextStyle(
                            color: BarkPalette.muted,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _openMaps,
                  icon: const Icon(Icons.map_outlined),
                  label: const Text('Abrir ubicación en Maps'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: BarkPalette.blue,
                    side: const BorderSide(color: BarkPalette.blue),
                    minimumSize: const Size.fromHeight(46),
                  ),
                ),
                const SizedBox(height: 10),
                const Text(
                  'El GPS mostrado corresponde a este dispositivo. El seguimiento remoto del paseador requiere una cuenta y un servicio de ubicación compartida.',
                  style: TextStyle(color: BarkPalette.muted, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _WalkerSummary extends StatelessWidget {
  const _WalkerSummary({required this.onCall, required this.onMessage});

  final VoidCallback onCall;
  final VoidCallback onMessage;

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
              const CircleAvatar(
                backgroundColor: Color(0xFFE3F2EC),
                foregroundColor: BarkPalette.emerald,
                child: Icon(Icons.person_outline),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Alex Morgan',
                      style: TextStyle(
                        color: BarkPalette.ink,
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      'Paseador de Max',
                      style: TextStyle(color: BarkPalette.muted),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.verified, color: BarkPalette.blue, size: 20),
            ],
          ),
          const Divider(height: 24),
          const Row(
            children: [
              Icon(Icons.pets, color: BarkPalette.emerald, size: 18),
              SizedBox(width: 8),
              Text('Max · Golden Retriever · 1 hora'),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onCall,
                  icon: const Icon(Icons.call_outlined, size: 18),
                  label: const Text('Llamar'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: onMessage,
                  icon: const Icon(Icons.sms_outlined, size: 18),
                  label: const Text('Mensaje'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
