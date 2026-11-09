import 'package:flutter/material.dart' hide Text;

import '../../../core/localization/bark_language.dart';
import '../../../core/theme/bark_theme.dart';
import 'barkwall_portal_screen.dart';
import '../../pet_profile/presentation/owner_registration_screen.dart';
import '../../shopper/presentation/walker_registration_screen.dart';

class RoleSelectionScreen extends StatefulWidget {
  const RoleSelectionScreen({super.key});

  @override
  State<RoleSelectionScreen> createState() => _RoleSelectionScreenState();
}

class _RoleSelectionScreenState extends State<RoleSelectionScreen>
    with SingleTickerProviderStateMixin {
  double _ownerScale = 1;
  double _walkerScale = 1;
  late final AnimationController _panelController;
  late final Animation<Offset> _panelSlide;

  @override
  void initState() {
    super.initState();
    _panelController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 650),
    );
    _panelSlide = Tween<Offset>(begin: const Offset(0, 0.25), end: Offset.zero)
        .animate(
          CurvedAnimation(parent: _panelController, curve: Curves.easeOutCubic),
        );
    _panelController.forward();
  }

  @override
  void dispose() {
    _panelController.dispose();
    super.dispose();
  }

  void _openRegistration(Widget screen) {
    Navigator.push(
      context,
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 400),
        pageBuilder: (context, animation, secondaryAnimation) => screen,
        transitionsBuilder: (context, animation, secondaryAnimation, child) {
          final position =
              Tween<Offset>(
                begin: const Offset(1, 0),
                end: Offset.zero,
              ).animate(
                CurvedAnimation(parent: animation, curve: Curves.easeOutCubic),
              );
          return SlideTransition(position: position, child: child);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => Stack(
            fit: StackFit.expand,
            children: [
              Positioned.fill(
                child: Container(
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        BarkPalette.blue,
                        Color(0xFF004D40),
                        BarkPalette.emerald,
                      ],
                    ),
                  ),
                ),
              ),
              Positioned.fill(
                child: Image.asset(
                  'assets/images/Gemini_Generated_Image_t7xd4ft7xd4ft7xd.jpeg',
                  fit: BoxFit.cover,
                  filterQuality: FilterQuality.high,
                  errorBuilder: (context, error, stackTrace) =>
                      const SizedBox.expand(),
                ),
              ),
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.black.withValues(alpha: 0.62),
                        Colors.black.withValues(alpha: 0.18),
                        Colors.black.withValues(alpha: 0.48),
                      ],
                    ),
                  ),
                ),
              ),
              Column(
                children: [
                  Expanded(
                    child: SingleChildScrollView(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(28, 48, 28, 36),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Align(
                              alignment: Alignment.centerRight,
                              child: Semantics(
                                label: localize(
                                  'Selecciona idioma',
                                  barkLanguage.value,
                                ),
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
                                    setState(() {
                                      barkLanguage.value = selection.first;
                                    });
                                  },
                                  style: ButtonStyle(
                                    visualDensity: VisualDensity.compact,
                                    backgroundColor:
                                        WidgetStateProperty.resolveWith(
                                          (states) =>
                                              states.contains(
                                                WidgetState.selected,
                                              )
                                              ? Colors.white.withValues(
                                                  alpha: 0.9,
                                                )
                                              : Colors.transparent,
                                        ),
                                    foregroundColor:
                                        WidgetStateProperty.resolveWith(
                                          (states) =>
                                              states.contains(
                                                WidgetState.selected,
                                              )
                                              ? BarkPalette.blue
                                              : Colors.white,
                                        ),
                                    side: const WidgetStatePropertyAll(
                                      BorderSide(color: Colors.white70),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 18),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 6,
                              ),
                              decoration: BoxDecoration(
                                color: BarkPalette.emerald,
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: const Text(
                                'BarkWalk USA',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14,
                                ),
                              ),
                            ),
                            const SizedBox(height: 18),
                            const Text(
                              'Encuentra paseadores\nprofesionales cerca de ti',
                              style: TextStyle(
                                fontSize: 32,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                                height: 1.2,
                              ),
                            ),
                            const SizedBox(height: 12),
                            const Text(
                              'Conoce a tu paseador y consulta la información de salud de tu mascota.',
                              style: TextStyle(
                                fontSize: 14,
                                color: Colors.white70,
                                height: 1.4,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  SlideTransition(
                    key: const ValueKey('registrationPanel'),
                    position: _panelSlide,
                    child: FadeTransition(
                      opacity: _panelController,
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.fromLTRB(24, 26, 24, 20),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.88),
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(30),
                          ),
                          boxShadow: const [
                            BoxShadow(
                              color: Colors.black38,
                              blurRadius: 20,
                              offset: Offset(0, -5),
                            ),
                          ],
                        ),
                        child: Center(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 480),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                const Text(
                                  'Selecciona tu tipo de cuenta',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.bold,
                                    color: BarkPalette.blue,
                                  ),
                                ),
                                const SizedBox(height: 20),
                                _AnimatedRegistrationButton(
                                  label: 'Registro de Dueño de Mascota',
                                  icon: Icons.pets,
                                  scale: _ownerScale,
                                  onScaleChanged: (value) =>
                                      setState(() => _ownerScale = value),
                                  onPressed: () => _openRegistration(
                                    const OwnerRegistrationScreen(),
                                  ),
                                  isOwner: true,
                                ),
                                const SizedBox(height: 12),
                                _AnimatedRegistrationButton(
                                  label: 'Registro de Paseador (Shopper)',
                                  icon: Icons.check_circle,
                                  scale: _walkerScale,
                                  onScaleChanged: (value) =>
                                      setState(() => _walkerScale = value),
                                  onPressed: () => _openRegistration(
                                    const WalkerRegistrationScreen(),
                                  ),
                                  isOwner: false,
                                ),
                                const SizedBox(height: 8),
                                TextButton.icon(
                                  onPressed: () => Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) =>
                                          const BarkWallPortalScreen(),
                                    ),
                                  ),
                                  icon: const Icon(Icons.dashboard_outlined),
                                  label: const Text('Abrir demo integrada'),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AnimatedRegistrationButton extends StatelessWidget {
  const _AnimatedRegistrationButton({
    required this.label,
    required this.icon,
    required this.scale,
    required this.onScaleChanged,
    required this.onPressed,
    required this.isOwner,
  });

  final String label;
  final IconData icon;
  final double scale;
  final ValueChanged<double> onScaleChanged;
  final VoidCallback onPressed;
  final bool isOwner;

  @override
  Widget build(BuildContext context) {
    final color = isOwner ? BarkPalette.emerald : BarkPalette.blue;
    return GestureDetector(
      onTapDown: (_) => onScaleChanged(0.95),
      onTapUp: (_) {
        onScaleChanged(1);
        onPressed();
      },
      onTapCancel: () => onScaleChanged(1),
      child: AnimatedScale(
        scale: scale,
        duration: const Duration(milliseconds: 100),
        child: Semantics(
          button: true,
          label: localize(label, barkLanguage.value),
          onTap: onPressed,
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
            decoration: BoxDecoration(
              color: isOwner ? BarkPalette.emerald : Colors.white,
              border: isOwner ? null : Border.all(color: color, width: 1.5),
              borderRadius: BorderRadius.circular(30),
              boxShadow: isOwner
                  ? const [
                      BoxShadow(
                        color: Colors.black12,
                        blurRadius: 8,
                        offset: Offset(0, 3),
                      ),
                    ]
                  : null,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, color: isOwner ? Colors.white : color, size: 18),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: isOwner ? Colors.white : color,
                      fontWeight: FontWeight.bold,
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
