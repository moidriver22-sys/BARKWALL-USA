import 'package:flutter/material.dart' hide Text;

import '../../../core/localization/bark_language.dart';
import '../../../core/models/bark_walk_role.dart';
import '../../../core/theme/bark_theme.dart';
import '../../../core/widgets/registration_widgets.dart';
import '../../registration/presentation/pending_approval_screen.dart';

class OwnerRegistrationScreen extends StatefulWidget {
  const OwnerRegistrationScreen({super.key});

  @override
  State<OwnerRegistrationScreen> createState() =>
      _OwnerRegistrationScreenState();
}

class _OwnerRegistrationScreenState extends State<OwnerRegistrationScreen> {
  final _formKey = GlobalKey<FormState>();
  bool _confirmed = false;

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    if (!_confirmed) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Confirma la información para continuar.'),
        ),
      );
      return;
    }
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => const PendingApprovalScreen(role: BarkWalkRole.owner),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Registro de dueño y mascota'),
        backgroundColor: BarkPalette.blue,
        foregroundColor: Colors.white,
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Información del perfil',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                color: BarkPalette.blue,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Completa los datos del dueño, tu mascota y su veterinario.',
              style: TextStyle(color: BarkPalette.muted),
            ),
            const SizedBox(height: 20),
            const RegistrationField(label: 'Nombre del propietario'),
            const SizedBox(height: 14),
            const RegistrationField(
              label: 'Dirección, ciudad, estado y ZIP',
              keyboardType: TextInputType.streetAddress,
            ),
            const SizedBox(height: 14),
            const RegistrationField(label: 'Nombre de la mascota'),
            const SizedBox(height: 14),
            const RegistrationField(label: 'Raza'),
            const SizedBox(height: 14),
            const RegistrationField(
              label: 'Clínica veterinaria y teléfono',
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: 22),
            const SecureVerificationCard(
              title: 'Certificado de vacunación',
              message: 'La carga cifrada de documentos se habilitará al conectar el almacenamiento seguro.',
              buttonLabel: 'Configurar carga segura',
            ),
            const SizedBox(height: 12),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _confirmed,
              onChanged: (value) => setState(() => _confirmed = value ?? false),
              controlAffinity: ListTileControlAffinity.leading,
              title: const Text(
                'Confirmo que la información del perfil es correcta.',
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
