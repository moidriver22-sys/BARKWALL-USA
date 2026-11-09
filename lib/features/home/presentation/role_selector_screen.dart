import 'package:flutter/material.dart' hide Text;

import '../../../core/localization/bark_language.dart';
import '../../admin_finance/presentation/barkwall_admin_finance_screen.dart';
import '../../shopper/presentation/shopper_home_screen.dart';
import 'client_home_screen.dart';
import 'role_selection_screen.dart';

class RoleSelectorScreen extends StatefulWidget {
  const RoleSelectorScreen({super.key});

  @override
  State<RoleSelectorScreen> createState() => _RoleSelectorScreenState();
}

class _RoleSelectorScreenState extends State<RoleSelectorScreen> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Align(
                    alignment: Alignment.centerRight,
                    child: SegmentedButton<BarkLanguage>(
                      showSelectedIcon: false,
                      segments: const [
                        ButtonSegment(
                          value: BarkLanguage.english,
                          label: Text('EN'),
                        ),
                        ButtonSegment(
                          value: BarkLanguage.spanish,
                          label: Text('ES'),
                        ),
                      ],
                      selected: {barkLanguage.value},
                      onSelectionChanged: (selection) {
                        setState(() => barkLanguage.value = selection.first);
                      },
                    ),
                  ),
                  const SizedBox(height: 32),
                  const Icon(
                    Icons.pets_rounded,
                    color: Color(0xFF2ECC71),
                    size: 60,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'BARKWALK ECOSYSTEM',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Selecciona el perfil que deseas simular',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                  const SizedBox(height: 36),
                  _RoleButton(
                    title: 'Vista Shopper (Operaciones)',
                    icon: Icons.delivery_dining_rounded,
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const ShopperHomeScreen(),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  _RoleButton(
                    title: 'Vista Cliente (Dueño de Mascota)',
                    icon: Icons.person_rounded,
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const ClientHomeScreen(),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  _RoleButton(
                    title: 'Vista Finanzas (Admin)',
                    icon: Icons.account_balance_wallet_rounded,
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const BarkWallAdminFinanceScreen(),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  TextButton(
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const RoleSelectionScreen(),
                      ),
                    ),
                    child: const Text(
                      'Continuar al registro',
                      style: TextStyle(color: Colors.white70),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RoleButton extends StatelessWidget {
  const _RoleButton({
    required this.title,
    required this.icon,
    required this.onPressed,
  });

  final String title;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFF1B4D3E),
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 18),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        icon: Icon(icon, color: const Color(0xFF2ECC71)),
        label: Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
        ),
      ),
    );
  }
}
