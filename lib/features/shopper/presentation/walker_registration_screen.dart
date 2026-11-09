import 'package:flutter/material.dart' hide Text;

import '../../../core/localization/bark_language.dart';
import '../../../core/models/bark_walk_role.dart';
import '../../../core/theme/bark_theme.dart';
import '../../../core/widgets/registration_widgets.dart';
import '../../registration/presentation/pending_approval_screen.dart';

class WalkerRegistrationScreen extends StatefulWidget {
  const WalkerRegistrationScreen({super.key});

  @override
  State<WalkerRegistrationScreen> createState() =>
      _WalkerRegistrationScreenState();
}

class _WalkerRegistrationScreenState extends State<WalkerRegistrationScreen> {
  final _formKey = GlobalKey<FormState>();
  bool _consent = false;

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    if (!_consent) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Se requiere autorización para continuar.'),
        ),
      );
      return;
    }
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => const PendingApprovalScreen(role: BarkWalkRole.walker),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Registro de paseador'),
        backgroundColor: BarkPalette.blue,
        foregroundColor: Colors.white,
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Identidad y requisitos',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                color: BarkPalette.blue,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Crea tu perfil para iniciar una verificación de identidad segura.',
              style: TextStyle(color: BarkPalette.muted),
            ),
            const SizedBox(height: 20),
            const RegistrationField(label: 'Nombre legal completo'),
            const SizedBox(height: 14),
            const RegistrationField(
              label: 'Correo electrónico',
              keyboardType: TextInputType.emailAddress,
              isEmail: true,
            ),
            const SizedBox(height: 14),
            const RegistrationField(
              label: 'Teléfono',
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 14),
            const RegistrationField(label: 'Estado de residencia'),
            const SizedBox(height: 22),
            const SecureVerificationCard(
              title: 'Verificación de identidad y antecedentes',
              message: 'La integración con un proveedor aprobado aún no está configurada. No introduzcas SSN/ITIN, licencia ni selfies en esta demo.',
              buttonLabel: 'Ver requisitos de seguridad',
            ),
            const SizedBox(height: 12),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _consent,
              onChanged: (value) => setState(() => _consent = value ?? false),
              controlAffinity: ListTileControlAffinity.leading,
              title: const Text(
                'Autorizo iniciar la verificación cuando se configure el proveedor seguro.',
                style: TextStyle(fontSize: 14),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _submit,
              style: FilledButton.styleFrom(
                backgroundColor: BarkPalette.emerald,
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: const Text('Enviar registro de demostración'),
            ),
          ],
        ),
      ),
    );
  }
}
