import 'package:flutter/material.dart' hide Text;

import '../localization/bark_language.dart';
import '../theme/bark_theme.dart';

class RegistrationField extends StatelessWidget {
  const RegistrationField({
    super.key,
    required this.label,
    this.keyboardType,
    this.isEmail = false,
  });

  final String label;
  final TextInputType? keyboardType;
  final bool isEmail;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<BarkLanguage>(
      valueListenable: barkLanguage,
      builder: (context, language, child) => TextFormField(
        keyboardType: keyboardType,
        textCapitalization: isEmail
            ? TextCapitalization.none
            : TextCapitalization.words,
        decoration: InputDecoration(
          labelText: localize(label, language),
          border: const OutlineInputBorder(),
        ),
        validator: (value) {
          final text = value?.trim() ?? '';
          if (text.isEmpty) {
            return localize('Este campo es obligatorio.', language);
          }
          if (isEmail && !text.contains('@')) {
            return localize('Introduce un correo válido.', language);
          }
          return null;
        },
      ),
    );
  }
}

class SecureVerificationCard extends StatelessWidget {
  const SecureVerificationCard({
    super.key,
    required this.title,
    required this.message,
    required this.buttonLabel,
  });

  final String title;
  final String message;
  final String buttonLabel;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF2F4),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.shield_outlined, color: BarkPalette.blue),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: BarkPalette.blue,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(message, style: const TextStyle(color: BarkPalette.ink)),
          const SizedBox(height: 10),
          TextButton.icon(
            onPressed: () => showDialog<void>(
              context: context,
              builder: (context) => AlertDialog(
                title: const Text('Integración segura pendiente'),
                content: const Text(
                  'Antes de recopilar documentos, datos fiscales o biométricos, conecta un proveedor de verificación aprobado y almacenamiento cifrado.',
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Entendido'),
                  ),
                ],
              ),
            ),
            icon: const Icon(Icons.info_outline),
            label: Text(buttonLabel),
          ),
        ],
      ),
    );
  }
}
