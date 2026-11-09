import 'dart:async';

import 'package:flutter/material.dart' hide Text;

import '../../../core/localization/bark_language.dart';
import '../../../core/models/pet_profile.dart';
import '../../../core/theme/bark_theme.dart';

class BarkWallAIAdvisorScreen extends StatefulWidget {
  const BarkWallAIAdvisorScreen({super.key});

  @override
  State<BarkWallAIAdvisorScreen> createState() =>
      _BarkWallAIAdvisorScreenState();
}

class _BarkWallAIAdvisorScreenState extends State<BarkWallAIAdvisorScreen> {
  static const _background = Color(0xFF121212);
  static const _card = Color(0xFF1A1A1A);
  static const _accent = Color(0xFF2ECC71);

  final _chatController = TextEditingController();
  final _scrollController = ScrollController();
  final _pet = const PetProfile(
    name: 'Max',
    breed: 'Golden Retriever',
    age: 3,
    allergies: ['Chicken', 'Corn'],
    medicalNotes: 'Mild digestive sensitivity. Keep fresh water available.',
  );
  final List<_AdvisorMessage> _messages = [];
  bool _isReplying = false;

  bool get _isEnglish => barkLanguage.value == BarkLanguage.english;

  @override
  void initState() {
    super.initState();
    _messages.add(
      _AdvisorMessage(
        fromAssistant: true,
        text: _isEnglish
            ? 'Hi, I can help review Max’s sample care profile. What would you like to know?'
            : 'Hola, puedo ayudarte a revisar la ficha de ejemplo de Max. ¿Qué te gustaría saber?',
      ),
    );
  }

  @override
  void dispose() {
    _chatController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _sendMessage() async {
    final question = _chatController.text.trim();
    if (question.isEmpty || _isReplying) return;

    setState(() {
      _messages.add(_AdvisorMessage(fromAssistant: false, text: question));
      _chatController.clear();
      _isReplying = true;
    });
    _scrollToLatest();

    await Future<void>.delayed(const Duration(milliseconds: 450));
    if (!mounted) return;

    setState(() {
      _messages.add(
        _AdvisorMessage(fromAssistant: true, text: _buildDemoReply(question)),
      );
      _isReplying = false;
    });
    _scrollToLatest();
  }

  String _buildDemoReply(String question) {
    final normalized = question.toLowerCase();
    final isEnglish = _isEnglish;
    final asksAboutFood =
        normalized.contains('chicken') ||
        normalized.contains('corn') ||
        normalized.contains('pollo') ||
        normalized.contains('maíz') ||
        normalized.contains('comida') ||
        normalized.contains('food') ||
        normalized.contains('snack');
    final asksAboutActivity =
        normalized.contains('walk') ||
        normalized.contains('exercise') ||
        normalized.contains('paseo') ||
        normalized.contains('ejercicio');
    final urgentSymptoms =
        normalized.contains('breathing') ||
        normalized.contains('seizure') ||
        normalized.contains('collapsed') ||
        normalized.contains('poison') ||
        normalized.contains('respira') ||
        normalized.contains('convuls') ||
        normalized.contains('veneno');

    if (urgentSymptoms) {
      return isEnglish
          ? 'This may need urgent veterinary attention. Contact an emergency veterinarian now; this demo cannot assess symptoms.'
          : 'Esto podría requerir atención veterinaria urgente. Contacta ahora a un veterinario de emergencia; esta demo no puede evaluar síntomas.';
    }
    if (asksAboutFood) {
      return isEnglish
          ? 'Max’s sample profile lists chicken and corn allergies. Check ingredient labels and confirm any diet changes with your veterinarian.'
          : 'La ficha de ejemplo de Max indica alergias al pollo y al maíz. Revisa las etiquetas y consulta con tu veterinario antes de cambiar su dieta.';
    }
    if (asksAboutActivity) {
      return isEnglish
          ? 'This sample profile has no vet-approved exercise plan. Ask Max’s veterinarian for a routine tailored to his health.'
          : 'Esta ficha de ejemplo no incluye un plan de ejercicio aprobado por su veterinario. Consulta con el veterinario de Max para definir una rutina adecuada.';
    }
    return isEnglish
        ? 'I can summarize the sample profile, but I cannot diagnose or recommend treatment. Please ask your veterinarian about health concerns.'
        : 'Puedo resumir la ficha de ejemplo, pero no diagnosticar ni recomendar tratamientos. Consulta con tu veterinario si tienes dudas de salud.';
  }

  void _scrollToLatest() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final isEnglish = _isEnglish;
    return Scaffold(
      backgroundColor: _background,
      appBar: AppBar(
        backgroundColor: BarkPalette.blue,
        foregroundColor: Colors.white,
        title: Row(
          children: [
            const Icon(Icons.psychology_rounded, color: _accent, size: 23),
            const SizedBox(width: 9),
            Text(
              isEnglish
                  ? 'BARKWALK CARE ADVISOR'
                  : 'ASESOR DE CUIDADO BARKWALK',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              controller: _scrollController,
              padding: const EdgeInsets.all(16),
              children: [
                _buildPetHealthCard(isEnglish),
                const SizedBox(height: 18),
                _buildWalkReportCard(isEnglish),
                const SizedBox(height: 20),
                Text(
                  isEnglish
                      ? 'Care questions · demo'
                      : 'Consultas de cuidado · demo',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                _buildSafetyNotice(isEnglish),
                const SizedBox(height: 14),
                for (final message in _messages)
                  _MessageBubble(message: message),
                if (_isReplying) _buildTypingIndicator(isEnglish),
              ],
            ),
          ),
          _buildComposer(isEnglish),
        ],
      ),
    );
  }

  Widget _buildPetHealthCard(bool isEnglish) {
    final allergyLabels = isEnglish ? 'Chicken · Corn' : 'Pollo · Maíz';
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _accent.withValues(alpha: 0.55)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const CircleAvatar(
                backgroundColor: BarkPalette.blue,
                child: Icon(Icons.pets, color: _accent),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  '${_pet.name} · ${_pet.breed}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              Text(
                isEnglish ? '${_pet.age} years' : '${_pet.age} años',
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ],
          ),
          const Divider(height: 24, color: Colors.white12),
          Text(
            isEnglish
                ? 'Recorded allergies (sample)'
                : 'Alergias registradas (muestra)',
            style: const TextStyle(
              color: _accent,
              fontWeight: FontWeight.w700,
              fontSize: 13,
            ),
          ),
          const SizedBox(height: 6),
          Text(allergyLabels, style: const TextStyle(color: Colors.white)),
          const SizedBox(height: 10),
          Text(
            isEnglish ? _pet.medicalNotes : 'Sensibilidad digestiva leve. Mantener agua fresca disponible.',
            style: const TextStyle(color: Colors.white70, fontSize: 13),
          ),
        ],
      ),
    );
  }

  Widget _buildWalkReportCard(bool isEnglish) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.summarize_outlined, color: _accent, size: 24),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isEnglish ? 'Walk report' : 'Reporte del paseo',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  isEnglish
                      ? 'No walk report is synced yet. Connect a tracking service to create summaries.'
                      : 'Aún no hay un reporte sincronizado. Conecta un servicio de rastreo para generar resúmenes.',
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 12,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSafetyNotice(bool isEnglish) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: BarkPalette.blue.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline, color: _accent, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              isEnglish
                  ? 'Demo only, not a medical AI or veterinarian. For diagnosis or treatment, contact your vet.'
                  : 'Solo demo; no es una IA médica ni un veterinario. Para diagnóstico o tratamiento, consulta a tu veterinario.',
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 12,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTypingIndicator(bool isEnglish) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: _card,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Text(
          isEnglish
              ? 'Reviewing the sample profile…'
              : 'Revisando la ficha de ejemplo…',
          style: const TextStyle(color: Colors.white70, fontSize: 12),
        ),
      ),
    );
  }

  Widget _buildComposer(bool isEnglish) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        decoration: const BoxDecoration(
          color: _card,
          border: Border(top: BorderSide(color: Colors.white12)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: _chatController,
                minLines: 1,
                maxLines: 4,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _sendMessage(),
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  hintText: isEnglish
                      ? 'Ask about Max’s sample care profile…'
                      : 'Pregunta sobre la ficha de ejemplo de Max…',
                  hintStyle: const TextStyle(color: Colors.white54),
                  filled: true,
                  fillColor: _background,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(22),
                    borderSide: BorderSide.none,
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 11,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              tooltip: isEnglish ? 'Send' : 'Enviar',
              onPressed: _isReplying ? null : _sendMessage,
              style: IconButton.styleFrom(backgroundColor: _accent),
              icon: const Icon(Icons.send_rounded, color: _background),
            ),
          ],
        ),
      ),
    );
  }
}

class _AdvisorMessage {
  const _AdvisorMessage({required this.fromAssistant, required this.text});

  final bool fromAssistant;
  final String text;
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final _AdvisorMessage message;

  @override
  Widget build(BuildContext context) {
    final isAssistant = message.fromAssistant;
    return Align(
      alignment: isAssistant ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 320),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(
          color: isAssistant
              ? const Color(0xFF1A1A1A)
              : const Color(0xFF1B4D3E),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Text(
          message.text,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 13,
            height: 1.35,
          ),
        ),
      ),
    );
  }
}
