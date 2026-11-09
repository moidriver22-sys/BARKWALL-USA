// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter/material.dart';
import 'package:barkwalk_usa/main.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> fillRegistrationFields(
  WidgetTester tester,
  List<String> values,
) async {
  final fields = find.byType(TextFormField);
  expect(fields, findsNWidgets(values.length));
  for (var index = 0; index < values.length; index++) {
    await tester.enterText(fields.at(index), values[index]);
  }
}

void main() {
  setUp(() {
    barkLanguage.value = BarkLanguage.english;
  });

  testWidgets('language selector changes the app to Spanish', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const DogWalkerApp());
    await tester.pumpAndSettle();

    expect(find.text('Find professional dog walkers near you'), findsOneWidget);
    await tester.tap(find.text('ES'));
    await tester.pumpAndSettle();

    expect(
      find.text('Encuentra paseadores\nprofesionales cerca de ti'),
      findsOneWidget,
    );
    await tester.tap(find.text('Registro de Dueño de Mascota'));
    await tester.pumpAndSettle();

    expect(find.text('Registro de dueño y mascota'), findsOneWidget);
  });

  testWidgets('unified demo switches between client and shopper views', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const DogWalkerApp());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Open unified demo'));
    await tester.tap(find.text('Open unified demo'));
    await tester.pumpAndSettle();

    expect(find.text('Choose a demo view'), findsOneWidget);
    await tester.tap(find.text('Client demo'));
    await tester.pumpAndSettle();
    expect(find.text('Live Pet Tracker'), findsOneWidget);

    await tester.tap(find.text('Shopper'));
    await tester.pumpAndSettle();
    expect(find.text('Assigned route · demo'), findsOneWidget);
    await tester.tap(find.text('Open route & QR demo'));
    await tester.pumpAndSettle();
    expect(find.text('SHOPPER ROUTE · DEMO'), findsOneWidget);
  });

  testWidgets('debug profile selector opens client dashboard', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: RoleSelectorScreen()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Client view (Pet Owner)'));
    await tester.pumpAndSettle();

    expect(find.text('BARKWALK CLIENT'), findsOneWidget);
  });

  testWidgets('debug profile selector opens shopper dashboard', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: RoleSelectorScreen()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Shopper view (Operations)'));
    await tester.pumpAndSettle();

    expect(find.text('Next service'), findsOneWidget);
  });

  testWidgets('debug profile selector opens finance demo', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: RoleSelectorScreen()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Finance view (Admin)'));
    await tester.pumpAndSettle();

    expect(find.text('FINANCE & AUTOMATION · DEMO'), findsOneWidget);
    expect(find.text('Sample gross volume · Homewood'), findsOneWidget);
    final pricingSwitch = tester.widget<Switch>(find.byType(Switch));
    expect(pricingSwitch.value, isTrue);
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
  });

  testWidgets('owner registration opens the client home and GPS monitor', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const DogWalkerApp());
    await tester.pumpAndSettle();

    expect(find.text('BarkWalk USA'), findsOneWidget);
    final panelRect = tester.getRect(
      find.byKey(const ValueKey('registrationPanel')),
    );
    final heroTextRect = tester.getRect(
      find.text('Find professional dog walkers near you'),
    );
    expect(panelRect.bottom, closeTo(600, 2));
    expect(heroTextRect.bottom, lessThan(panelRect.top));
    await tester.tap(find.text('Pet Owner Registration'));
    await tester.pumpAndSettle();

    expect(find.text('Owner & Pet Registration'), findsOneWidget);
    await fillRegistrationFields(tester, [
      'Taylor Morgan',
      '123 Highland Ave, Birmingham, AL 35203',
      'Max',
      'Golden Retriever',
      'Birmingham Vet 2055550144',
    ]);
    await tester.drag(find.byType(ListView), const Offset(0, -600));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CheckboxListTile));
    await tester.ensureVisible(find.text('Submit demo registration'));
    await tester.tap(find.text('Submit demo registration'));
    await tester.pumpAndSettle();

    expect(find.text('Verification in progress'), findsOneWidget);
    expect(find.textContaining('no information was submitted'), findsOneWidget);
    await tester.tap(find.text('Simulate demo approval'));
    await tester.pumpAndSettle();

    expect(find.text('BARKWALK CLIENT'), findsOneWidget);
    expect(
      find.text('Max’s walk · remote tracking unavailable'),
      findsOneWidget,
    );
    expect(find.text('My pets'), findsOneWidget);
    expect(find.text('BarkWalk Perks & Subscriptions'), findsOneWidget);
    await tester.ensureVisible(find.text('Open care advisor demo'));
    await tester.tap(find.text('Open care advisor demo'));
    await tester.pumpAndSettle();

    expect(find.text('BARKWALK CARE ADVISOR'), findsOneWidget);
    expect(find.textContaining('Chicken · Corn'), findsOneWidget);
    await tester.enterText(
      find.byType(TextField),
      'Can Max have chicken snacks?',
    );
    await tester.tap(find.byIcon(Icons.send_rounded));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('profile lists chicken and corn allergies'),
      findsOneWidget,
    );
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('Open device GPS map'));
    await tester.pumpAndSettle();

    expect(find.text('Walk tracking'), findsOneWidget);
    expect(find.text('Start tracking'), findsOneWidget);
    expect(find.text('Open location in Maps'), findsOneWidget);
    expect(find.text('Call'), findsOneWidget);
    expect(find.text('Message'), findsOneWidget);
  });

  testWidgets('walker registration opens route and completes a demo walk', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const DogWalkerApp());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Dog Walker Registration'));
    await tester.tap(find.text('Dog Walker Registration'));
    await tester.pumpAndSettle();

    expect(find.text('Walker registration'), findsOneWidget);
    await fillRegistrationFields(tester, [
      'Alex Morgan',
      'alex@example.com',
      '2055550144',
      'Alabama',
    ]);
    await tester.drag(find.byType(ListView), const Offset(0, -600));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CheckboxListTile));
    await tester.ensureVisible(find.text('Submit demo registration'));
    await tester.tap(find.text('Submit demo registration'));
    await tester.pumpAndSettle();

    expect(find.text('Verification in progress'), findsOneWidget);
    await tester.tap(find.text('Simulate demo approval'));
    await tester.pumpAndSettle();

    expect(find.text('Next service'), findsOneWidget);
    expect(find.text('Walks today'), findsOneWidget);
    expect(find.text('Start service'), findsOneWidget);
    await tester.tap(find.text('View requests and routes'));
    await tester.pumpAndSettle();

    expect(find.text('SHOPPER ROUTE · DEMO'), findsOneWidget);
    expect(find.text('Upcoming stops · Homewood'), findsOneWidget);
    expect(find.text('Chicken allergy'), findsOneWidget);
    await tester.tap(find.text('Scan to finish · demo'));
    await tester.pumpAndSettle();

    expect(find.text('QR scan simulation · Max'), findsOneWidget);
    await tester.tap(find.text('Simulate walk completion'));
    await tester.pumpAndSettle();

    expect(
      find.text('Demo walk marked complete. No QR or GPS was verified.'),
      findsOneWidget,
    );
    expect(find.text('1 completed · 2 remaining'), findsOneWidget);
  });
}
