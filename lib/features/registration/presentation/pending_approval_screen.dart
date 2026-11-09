import 'package:flutter/material.dart' hide Text;

import '../../../core/localization/bark_language.dart';
import '../../../core/models/bark_walk_role.dart';
import '../../../core/theme/bark_theme.dart';
import '../../home/presentation/client_home_screen.dart';
import '../../shopper/presentation/shopper_home_screen.dart';

class PendingApprovalScreen extends StatelessWidget {
  const PendingApprovalScreen({super.key, required this.role});

  final BarkWalkRole role;

  @override
  Widget build(BuildContext context) {
    final isWalker = role == BarkWalkRole.walker;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Verificación en proceso'),
        backgroundColor: BarkPalette.blue,
        foregroundColor: Colors.white,
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.hourglass_top,
                size: 72,
                color: BarkPalette.emerald,
              ),
              const SizedBox(height: 22),
              Text(
                isWalker
                    ? 'Perfil de paseador en revisión'
                    : 'Perfil de dueño listo para verificar',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  color: BarkPalette.blue,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Esta es una demostración: no se envió información ni se ejecutó una verificación real.',
                textAlign: TextAlign.center,
                style: TextStyle(color: BarkPalette.muted),
              ),
              const SizedBox(height: 28),
              FilledButton.icon(
                onPressed: () => Navigator.pushAndRemoveUntil(
                  context,
                  MaterialPageRoute(
                    builder: (_) => isWalker
                        ? const ShopperHomeScreen()
                        : const ClientHomeScreen(),
                  ),
                  (route) => route.isFirst,
                ),
                icon: const Icon(Icons.check_circle_outline),
                label: const Text('Simular aprobación demo'),
                style: FilledButton.styleFrom(
                  backgroundColor: BarkPalette.blue,
                  padding: const EdgeInsets.symmetric(
                    vertical: 15,
                    horizontal: 20,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
