import 'package:flutter/material.dart' hide Text;

import '../../../core/localization/bark_language.dart';
import '../../pet_profile/presentation/barkwall_ai_advisor_screen.dart';
import '../../pet_tracker/presentation/owner_tracking_screen.dart';

class ClientHomeScreen extends StatefulWidget {
  const ClientHomeScreen({super.key});

  @override
  State<ClientHomeScreen> createState() => _ClientHomeScreenState();
}

class _ClientHomeScreenState extends State<ClientHomeScreen> {
  static const Color _primaryGreen = Color(0xFF1B4D3E);
  static const Color _darkBackground = Color(0xFF121212);
  static const Color _cardBackground = Color(0xFF1E1E1E);
  static const Color _accentGreen = Color(0xFF2ECC71);

  void _showPendingFeature(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  void _openDeviceTracker() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const OwnerTrackingScreen()),
    );
  }

  void _openCareAdvisor() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const BarkWallAIAdvisorScreen()),
    );
  }

  void _showPetProfile() {
    final isEnglish = barkLanguage.value == BarkLanguage.english;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: _cardBackground,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                isEnglish ? 'Max’s pet profile' : 'Perfil de Max',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                isEnglish
                    ? 'Golden Retriever · Example profile'
                    : 'Golden Retriever · Perfil de ejemplo',
                style: const TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 8),
              Text(
                isEnglish
                    ? 'Health records are not saved in this demo.'
                    : 'Los datos médicos no se guardan en esta demo.',
                style: const TextStyle(color: Colors.white70),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isEnglish = barkLanguage.value == BarkLanguage.english;
    return Scaffold(
      backgroundColor: _darkBackground,
      appBar: AppBar(
        backgroundColor: _primaryGreen,
        elevation: 0,
        title: Row(
          children: [
            const Icon(Icons.pets, color: Colors.white, size: 22),
            const SizedBox(width: 8),
            Text(
              isEnglish ? 'BARKWALK CLIENT' : 'BARKWALK CLIENTE',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: isEnglish ? 'Notifications' : 'Notificaciones',
            icon: const Icon(Icons.notifications_outlined, color: Colors.white),
            onPressed: () => _showPendingFeature(
              isEnglish
                  ? 'Notifications are not connected in this demo.'
                  : 'Las notificaciones no están conectadas en esta demo.',
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              isEnglish ? 'Current activity' : 'Actividad en curso',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            _buildActiveTrackerCard(isEnglish),
            const SizedBox(height: 24),
            Text(
              isEnglish ? 'My pets' : 'Mis Mascotas',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            _buildPetProfileCard(isEnglish),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _openCareAdvisor,
              icon: const Icon(Icons.psychology_rounded),
              label: Text(
                isEnglish
                    ? 'Open care advisor demo'
                    : 'Abrir asesor de cuidado demo',
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: _accentGreen,
                side: const BorderSide(color: _accentGreen),
                minimumSize: const Size.fromHeight(44),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              isEnglish
                  ? 'BarkWalk Perks & Subscriptions'
                  : 'BarkWalk Perks & Suscripciones',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            _buildPerksCard(isEnglish),
            const SizedBox(height: 16),
          ],
        ),
      ),
      bottomNavigationBar: BottomNavigationBar(
        backgroundColor: _cardBackground,
        selectedItemColor: _accentGreen,
        unselectedItemColor: Colors.grey,
        currentIndex: 0,
        onTap: (index) {
          if (index == 3) {
            _showPetProfile();
          } else if (index == 1 || index == 2) {
            _showPendingFeature(
              isEnglish
                  ? 'This section is not available in the demo yet.'
                  : 'Esta sección todavía no está disponible en la demo.',
            );
          }
        },
        items: [
          BottomNavigationBarItem(
            icon: const Icon(Icons.home),
            label: isEnglish ? 'Home' : 'Inicio',
          ),
          BottomNavigationBarItem(
            icon: const Icon(Icons.map),
            label: isEnglish ? 'Explore' : 'Explorar',
          ),
          BottomNavigationBarItem(
            icon: const Icon(Icons.chat),
            label: isEnglish ? 'Chat' : 'Chat',
          ),
          BottomNavigationBarItem(
            icon: const Icon(Icons.person),
            label: isEnglish ? 'Profile' : 'Perfil',
          ),
        ],
      ),
    );
  }

  Widget _buildActiveTrackerCard(bool isEnglish) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBackground,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _accentGreen, width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.fiber_manual_record,
                color: _accentGreen,
                size: 14,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  isEnglish
                      ? 'Max’s walk · remote tracking unavailable'
                      : 'Paseo con Max · rastreo remoto no disponible',
                  style: const TextStyle(
                    color: _accentGreen,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            height: 130,
            width: double.infinity,
            decoration: BoxDecoration(
              color: _darkBackground,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.white10),
            ),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(
                      Icons.location_searching,
                      color: _accentGreen,
                      size: 32,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      isEnglish
                          ? 'The assigned walker’s live location is not connected yet.'
                          : 'La ubicación en vivo del paseador aún no está conectada.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          ElevatedButton.icon(
            onPressed: _openDeviceTracker,
            style: ElevatedButton.styleFrom(
              backgroundColor: _primaryGreen,
              foregroundColor: Colors.white,
              minimumSize: const Size.fromHeight(42),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            icon: const Icon(Icons.visibility, size: 18),
            label: Text(
              isEnglish
                  ? 'Open device GPS map'
                  : 'Abrir mapa GPS del dispositivo',
              style: const TextStyle(fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPetProfileCard(bool isEnglish) {
    return InkWell(
      onTap: _showPetProfile,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: _cardBackground,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white10),
        ),
        child: Row(
          children: [
            const CircleAvatar(
              radius: 28,
              backgroundColor: _primaryGreen,
              child: Icon(Icons.pets, color: Colors.white, size: 28),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Max',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    isEnglish
                        ? 'Golden Retriever · Sample profile'
                        : 'Golden Retriever · Perfil de ejemplo',
                    style: const TextStyle(color: Colors.grey, fontSize: 12),
                  ),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_ios, color: Colors.grey, size: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildPerksCard(bool isEnglish) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _cardBackground,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: Row(
        children: [
          const Icon(Icons.card_giftcard, color: _accentGreen, size: 32),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isEnglish
                      ? 'Auto-Ship & Supplies'
                      : 'Auto-Ship & Suministros',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  isEnglish
                      ? 'Subscriptions and discounts are not connected yet.'
                      : 'Las suscripciones y descuentos aún no están conectados.',
                  style: const TextStyle(color: Colors.grey, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
