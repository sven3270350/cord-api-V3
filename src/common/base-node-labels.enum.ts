import { registerEnumType } from '@nestjs/graphql';

export enum SearchableBaseNodeLabels {
  Project = 'Project',
  Language = 'Language',
  Organization = 'Organization',
  Location = 'Location',
  Film = 'Film',
  Story = 'Story',
  LiteracyMaterial = 'LiteracyMaterial',
  User = 'User',
}

export enum BaseNodeLabel {
  Budget = 'Budget',
  BudgetRecord = 'BudgetRecord',
  Ceremony = 'Ceremony',
  Directory = 'Directory',
  Education = 'Education',
  Engagement = 'Engagement',
  EthnologueLanguage = 'EthnologueLanguage',
  FieldRegion = 'FieldRegion',
  FieldZone = 'FieldZone',
  File = 'File',
  FileVersion = 'FileVersion',
  Film = 'Film',
  FundingAccount = 'FundingAccount',
  InternshipEngagement = 'InternshipEngagement',
  Language = 'Language',
  LanguageEngagement = 'LanguageEngagement',
  LiteracyMaterial = 'LiteracyMaterial',
  Location = 'Location',
  Organization = 'Organization',
  Partner = 'Partner',
  Partnership = 'Partnership',
  Project = 'Project',
  ProjectMember = 'ProjectMember',
  Producible = 'Producible',
  Product = 'Product',
  Song = 'Song',
  Story = 'Story',
  Unavailability = 'Unavailability',
  User = 'User',
}

export enum DbBaseNodeLabel {
  Budget = 'DbBudget',
  BudgetRecord = 'DbBudgetRecord',
  Ceremony = 'DbCeremony',
  Directory = 'DbDirectory',
  Education = 'DbEducation',
  Engagement = 'DbEngagement',
  EthnologueLanguage = 'DbEthnologueLanguage',
  FieldRegion = 'DbFieldRegion',
  FieldZone = 'DbFieldZone',
  File = 'DbFile',
  FileVersion = 'DbFileVersion',
  Film = 'DbFilm',
  FundingAccount = 'DbFundingAccount',
  InternshipEngagement = 'DbInternshipEngagement',
  Language = 'DbLanguage',
  LanguageEngagement = 'DbLanguageEngagement',
  LiteracyMaterial = 'DbLiteracyMaterial',
  Location = 'DbLocation',
  Organization = 'DbOrganization',
  Partner = 'DbPartner',
  Partnership = 'DbPartnership',
  Project = 'DbProject',
  ProjectMember = 'DbProjectMember',
  Producible = 'DbProducible',
  Product = 'DbProduct',
  Song = 'DbSong',
  Story = 'DbStory',
  Unavailability = 'DbUnavailability',
  User = 'DbUser',
}

registerEnumType(BaseNodeLabel, {
  name: 'BaseNodeLabel',
});

registerEnumType(SearchableBaseNodeLabels, {
  name: 'SearchableBaseNodeLabels',
});
