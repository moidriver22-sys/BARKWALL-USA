import 'package:flutter/material.dart' hide Text;

import '../../../core/localization/bark_language.dart';
import '../../../core/models/bark_walk_role.dart';
import '../../../core/theme/bark_theme.dart';
import '../../pet_profile/presentation/barkwall_ai_advisor_screen.dart';
import '../../pet_tracker/presentation/owner_tracking_screen.dart';
import '../../shopper/presentation/shopper_route_qr_screen.dart';
import 'role_selection_screen.dart';

const Color _accent = Color(0xFF00C86F);
const Color _card = Color(0xFF131A16);
const Color _deep = Color(0xFF070A08);

class BarkWallPortalScreen extends StatefulWidget {
  const BarkWallPortalScreen({super.key});

  @override
  State<BarkWallPortalScreen> createState() => _BarkWallPortalScreenState();
}

class _BarkWallPortalScreenState extends State<BarkWallPortalScreen> {
  static const _background = Color(0xFF0A0D0B);

  bool _hasEntered = false;
  BarkWalkRole _role = BarkWalkRole.owner;
  int _navigationIndex = 0;

  bool get _isEnglish => barkLanguage.value == BarkLanguage.english;

  void _enter(BarkWalkRole role) {
    setState(() {
      _role = role;
      _hasEntered = true;
      _navigationIndex = 0;
    });
  }

  void _goHome() {
    setState(() {
      _hasEntered = false;
      _navigationIndex = 0;
    });
  }

  void _open(Widget screen) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context) {
    return _hasEntered ? _buildDashboard() : _buildWelcome();
  }

  Widget _buildWelcome() {
    final isEnglish = _isEnglish;
    return Scaffold(
      backgroundColor: _background,
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            Positioned.fill(
              child: Image.asset(
                'assets/images/Gemini_Generated_Image_t7xd4ft7xd4ft7xd.jpeg',
                fit: BoxFit.cover,
                filterQuality: FilterQuality.high,
                errorBuilder: (context, error, stackTrace) =>
                    const ColoredBox(color: BarkPalette.blue),
              ),
            ),
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.black.withValues(alpha: 0.18),
                      Colors.black.withValues(alpha: 0.35),
                      _background.withValues(alpha: 0.98),
                    ],
                    stops: const [0, 0.48, 1],
                  ),
                ),
              ),
            ),
            LayoutBuilder(
              builder: (context, constraints) => SingleChildScrollView(
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Align(
                          alignment: Alignment.topRight,
                          child: _LanguageSwitch(
                            isEnglish: isEnglish,
                            onChanged: (language) {
                              setState(() => barkLanguage.value = language);
                            },
                          ),
                        ),
                        SizedBox(height: constraints.maxHeight * 0.18),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: BarkPalette.emerald,
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                              color: _accent.withValues(alpha: 0.4),
                            ),
                          ),
                          child: const Text(
                            'BarkWalk USA',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                        Text(
                          isEnglish ? 'Find professional dog walkers near you' : 'Encuentra paseadores profesionales cerca de ti',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 27,
                            fontWeight: FontWeight.w800,
                            height: 1.12,
                          ),
                        ),
                        const SizedBox(height: 9),
                        Text(
                          isEnglish
                              ? 'Meet your walker and access your pet’s health information.'
                              : 'Conoce a tu paseador y consulta la información de salud de tu mascota.',
                          style: const TextStyle(
                            color: Colors.white70,
                            fontSize: 13,
                            height: 1.4,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          isEnglish
                              ? 'Paseadores certificados y perros felices'
                              : 'Paseadores certificados y perros felices',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 24),
                        Text(
                          isEnglish
                              ? 'Choose a demo view'
                              : 'Selecciona una vista de demostración',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Colors.white70,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 10),
                        _WelcomeButton(
                          label: isEnglish ? 'Client demo' : 'Demo Cliente',
                          icon: Icons.pets_rounded,
                          isPrimary: true,
                          onPressed: () => _enter(BarkWalkRole.owner),
                        ),
                        const SizedBox(height: 10),
                        _WelcomeButton(
                          label: isEnglish ? 'Shopper demo' : 'Demo Shopper',
                          icon: Icons.work_outline_rounded,
                          isPrimary: false,
                          onPressed: () => _enter(BarkWalkRole.walker),
                        ),
                        const SizedBox(height: 8),
                        Center(
                          child: TextButton(
                            onPressed: () => _open(const RoleSelectionScreen()),
                            child: Text(
                              isEnglish
                                  ? 'Create an account'
                                  : 'Crear una cuenta',
                              style: const TextStyle(color: Colors.white70),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDashboard() {
    final isEnglish = _isEnglish;
    return Scaffold(
      backgroundColor: _background,
      appBar: AppBar(
        backgroundColor: BarkPalette.blue,
        foregroundColor: Colors.white,
        titleSpacing: 16,
        title: InkWell(
          onTap: _goHome,
          child: const Row(
            children: [
              Icon(Icons.shield_rounded, color: _accent, size: 23),
              SizedBox(width: 8),
              Text(
                'BARKWALK',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
            ],
          ),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: SegmentedButton<BarkWalkRole>(
              showSelectedIcon: false,
              segments: [
                ButtonSegment(
                  value: BarkWalkRole.owner,
                  label: Text(isEnglish ? 'Client' : 'Cliente'),
                ),
                const ButtonSegment(
                  value: BarkWalkRole.walker,
                  label: Text('Shopper'),
                ),
              ],
              selected: {_role},
              onSelectionChanged: (selection) {
                setState(() => _role = selection.first);
              },
            ),
          ),
        ],
      ),
      body: _role == BarkWalkRole.owner
          ? _buildClientDashboard(isEnglish)
          : _buildShopperDashboard(isEnglish),
      bottomNavigationBar: BottomNavigationBar(
        backgroundColor: BarkPalette.blue,
        selectedItemColor: _accent,
        unselectedItemColor: Colors.white54,
        currentIndex: _navigationIndex,
        onTap: _onNavigationTap,
        items: [
          BottomNavigationBarItem(
            icon: const Icon(Icons.home_rounded),
            label: isEnglish ? 'Home' : 'Inicio',
          ),
          BottomNavigationBarItem(
            icon: const Icon(Icons.analytics_outlined),
            label: isEnglish ? 'Metrics' : 'Métricas',
          ),
          BottomNavigationBarItem(
            icon: const Icon(Icons.person_outline_rounded),
            label: isEnglish ? 'Profile' : 'Perfil',
          ),
        ],
      ),
    );
  }

  Widget _buildClientDashboard(bool isEnglish) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _ClientPetCard(isEnglish: isEnglish),
        const SizedBox(height: 14),
        _ClientTrackerCard(
          isEnglish: isEnglish,
          onOpen: () => _open(const OwnerTrackingScreen()),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: _card,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: _accent.withValues(alpha: 0.3)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.smart_toy_outlined,
                    color: _accent,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'BarkWalk AI Advisor',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                isEnglish
                    ? 'Ask about Max’s sample care profile.'
                    : 'Consulta la ficha de cuidado de ejemplo de Max.',
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () => _open(const BarkWallAIAdvisorScreen()),
                icon: const Icon(Icons.chat_bubble_outline),
                label: Text(isEnglish ? 'Open care advisor' : 'Abrir asesor'),
                style: OutlinedButton.styleFrom(foregroundColor: _accent),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildShopperDashboard(bool isEnglish) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(
              child: _StatCard(
                label: isEnglish
                    ? 'Today’s earnings · sample'
                    : 'Ganancias de hoy · demo',
                value: '\$115.00',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _StatCard(
                label: isEnglish ? 'Route plan' : 'Plan de ruta',
                value: isEnglish ? '3 stops' : '3 paradas',
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: _card,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: _accent.withValues(alpha: 0.35)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.route_outlined, color: _accent, size: 20),
                  const SizedBox(width: 8),
                  Text(
                    isEnglish
                        ? 'Assigned route · demo'
                        : 'Ruta asignada · demo',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Text(
                'Max · Golden Retriever',
                style: TextStyle(color: Colors.white, fontSize: 15),
              ),
              const SizedBox(height: 5),
              Text(
                isEnglish
                    ? '1800 29th Ave S, Homewood · 10:00 AM'
                    : '1800 29th Ave S, Homewood · 10:00 AM',
                style: const TextStyle(color: Colors.white60, fontSize: 12),
              ),
              const SizedBox(height: 10),
              Text(
                isEnglish
                    ? '⚠ Avoid chicken (sample alert)'
                    : '⚠ Evitar pollo (alerta de muestra)',
                style: const TextStyle(color: Colors.amber, fontSize: 12),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: () => _open(const ShopperRouteAndQRScreen()),
                icon: const Icon(Icons.qr_code_scanner),
                label: Text(
                  isEnglish ? 'Open route & QR demo' : 'Abrir ruta y QR demo',
                ),
                style: FilledButton.styleFrom(
                  backgroundColor: BarkPalette.emerald,
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(44),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Text(
          isEnglish
              ? 'Earnings and route details are sample data.'
              : 'Las ganancias y la ruta son datos de muestra.',
          style: const TextStyle(color: Colors.white54, fontSize: 12),
        ),
      ],
    );
  }

  void _onNavigationTap(int index) {
    setState(() => _navigationIndex = index);
    if (index == 0) return;
    if (index == 1) {
      _open(
        _role == BarkWalkRole.walker
            ? const ShopperRouteAndQRScreen()
            : const OwnerTrackingScreen(),
      );
      return;
    }
    if (_role == BarkWalkRole.owner) {
      _open(const BarkWallAIAdvisorScreen());
      return;
    }
    final message = _isEnglish
        ? 'Profile tools are not connected in this demo.'
        : 'Las herramientas de perfil aún no están conectadas en esta demo.';
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}

class _LanguageSwitch extends StatelessWidget {
  const _LanguageSwitch({required this.isEnglish, required this.onChanged});

  final bool isEnglish;
  final ValueChanged<BarkLanguage> onChanged;

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<BarkLanguage>(
      showSelectedIcon: false,
      segments: const [
        ButtonSegment(value: BarkLanguage.english, label: Text('EN')),
        ButtonSegment(value: BarkLanguage.spanish, label: Text('ES')),
      ],
      selected: {isEnglish ? BarkLanguage.english : BarkLanguage.spanish},
      onSelectionChanged: (selection) => onChanged(selection.first),
      style: ButtonStyle(
        visualDensity: VisualDensity.compact,
        foregroundColor: const WidgetStatePropertyAll(Colors.white),
        side: const WidgetStatePropertyAll(BorderSide(color: Colors.white54)),
      ),
    );
  }
}

class _WelcomeButton extends StatelessWidget {
  const _WelcomeButton({
    required this.label,
    required this.icon,
    required this.isPrimary,
    required this.onPressed,
  });

  final String label;
  final IconData icon;
  final bool isPrimary;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 18),
        label: Text(label, style: const TextStyle(fontWeight: FontWeight.bold)),
        style: FilledButton.styleFrom(
          backgroundColor: isPrimary
              ? _accent
              : Colors.white.withValues(alpha: 0.12),
          foregroundColor: isPrimary ? const Color(0xFF07120D) : Colors.white,
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          side: isPrimary ? null : const BorderSide(color: Colors.white24),
        ),
      ),
    );
  }
}

class _ClientPetCard extends StatelessWidget {
  const _ClientPetCard({required this.isEnglish});

  final bool isEnglish;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _accent.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const CircleAvatar(
            backgroundColor: BarkPalette.blue,
            child: Icon(Icons.pets, color: _accent),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Max (Golden Retriever)',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  isEnglish
                      ? 'Chicken allergy · sample'
                      : 'Alergia: pollo · muestra',
                  style: const TextStyle(color: Colors.redAccent, fontSize: 11),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                isEnglish ? 'At home' : 'En casa',
                style: const TextStyle(color: _accent, fontSize: 11),
              ),
              const Text(
                'Homewood, AL',
                style: TextStyle(color: Colors.white54, fontSize: 10),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ClientTrackerCard extends StatelessWidget {
  const _ClientTrackerCard({required this.isEnglish, required this.onOpen});

  final bool isEnglish;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _accent.withValues(alpha: 0.3)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Icon(Icons.location_on_outlined, color: _accent, size: 18),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  isEnglish ? 'Live Pet Tracker' : 'Rastreo de mascota',
                  style: const TextStyle(
                    color: _accent,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              _DemoBadge(isEnglish: isEnglish),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            height: 140,
            width: double.infinity,
            decoration: BoxDecoration(
              color: _deep,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.white10),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.navigation_rounded, color: _accent, size: 28),
                const SizedBox(height: 8),
                Text(
                  isEnglish
                      ? 'Route preview · Central Ave'
                      : 'Vista previa · Central Ave',
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                ),
                const SizedBox(height: 3),
                Text(
                  isEnglish
                      ? 'Remote GPS is not connected.'
                      : 'GPS remoto no conectado.',
                  style: const TextStyle(color: Colors.white54, fontSize: 10),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: onOpen,
            icon: const Icon(Icons.map_outlined, size: 17),
            label: Text(
              isEnglish ? 'Open device GPS demo' : 'Abrir GPS del dispositivo',
            ),
            style: OutlinedButton.styleFrom(
              foregroundColor: _accent,
              side: const BorderSide(color: _accent),
              minimumSize: const Size.fromHeight(42),
            ),
          ),
        ],
      ),
    );
  }
}

class _DemoBadge extends StatelessWidget {
  const _DemoBadge({required this.isEnglish});

  final bool isEnglish;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: _accent.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _accent.withValues(alpha: 0.35)),
      ),
      child: Text(
        isEnglish ? 'GPS SIMULATION' : 'SIMULACIÓN GPS',
        style: const TextStyle(
          color: _accent,
          fontSize: 9,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _accent.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(color: Colors.white60, fontSize: 11),
          ),
          const SizedBox(height: 5),
          Text(
            value,
            style: const TextStyle(
              color: _accent,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}
