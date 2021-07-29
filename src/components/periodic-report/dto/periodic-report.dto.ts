import { Field, InterfaceType, ObjectType } from '@nestjs/graphql';
import { keys as keysOf } from 'ts-transformer-keys';
import { MergeExclusive } from 'type-fest';
import {
  CalendarDate,
  Resource,
  SecuredProperty,
  SecuredProps,
  ServerException,
  simpleSwitch,
} from '../../../common';
import { DefinedFile } from '../../file';
import { ReportType } from './report-type.enum';

type AnyPeriodicReport = MergeExclusive<
  MergeExclusive<FinancialReport, NarrativeReport>,
  ProgressReport
>;

export const resolveReportType = (report: PeriodicReport) => {
  const type = simpleSwitch(report.type, {
    Financial: FinancialReport,
    Narrative: NarrativeReport,
    Progress: ProgressReport,
  });
  if (!type) {
    throw new ServerException('Could not resolve periodic report type');
  }
  return type;
};

@InterfaceType({
  resolveType: resolveReportType,
  implements: [Resource],
})
class PeriodicReport extends Resource {
  static readonly Props = keysOf<PeriodicReport>();
  static readonly SecuredProps = keysOf<SecuredProps<PeriodicReport>>();

  @Field(() => ReportType)
  readonly type: ReportType;

  @Field()
  readonly start: CalendarDate;

  @Field()
  readonly end: CalendarDate;

  readonly reportFile: DefinedFile;
}

export {
  PeriodicReport as IPeriodicReport,
  AnyPeriodicReport as PeriodicReport,
};

@ObjectType({
  implements: [PeriodicReport],
})
export class FinancialReport extends PeriodicReport {
  static readonly Props = keysOf<FinancialReport>();
  static readonly SecuredProps = keysOf<SecuredProps<FinancialReport>>();

  readonly type: ReportType.Financial;
}

@ObjectType({
  implements: [PeriodicReport],
})
export class NarrativeReport extends PeriodicReport {
  static readonly Props = keysOf<NarrativeReport>();
  static readonly SecuredProps = keysOf<SecuredProps<NarrativeReport>>();

  readonly type: ReportType.Narrative;
}

@ObjectType({
  implements: [PeriodicReport],
})
export class ProgressReport extends PeriodicReport {
  static readonly Props = keysOf<ProgressReport>();
  static readonly SecuredProps = keysOf<SecuredProps<ProgressReport>>();

  readonly type: ReportType.Progress;
}

@ObjectType({
  description: SecuredProperty.descriptionFor('Secured Periodic Report'),
})
export class SecuredPeriodicReport extends SecuredProperty(PeriodicReport) {}
