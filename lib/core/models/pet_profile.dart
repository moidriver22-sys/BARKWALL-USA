class PetProfile {
  const PetProfile({
    required this.name,
    required this.breed,
    required this.age,
    required this.allergies,
    required this.medicalNotes,
  });

  final String name;
  final String breed;
  final int age;
  final List<String> allergies;
  final String medicalNotes;
}
