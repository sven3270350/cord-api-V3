import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  DuplicateException,
  generateId,
  ID,
  InputException,
  NotFoundException,
  ObjectView,
  Order,
  ResourceShape,
  ServerException,
  Session,
  UnauthorizedException,
  viewOfChangeset,
} from '../../common';
import { HandleIdLookup, ILogger, Logger, ResourceResolver } from '../../core';
import {
  mapListResults,
  parseSecuredProperties,
} from '../../core/database/results';
import {
  AuthorizationService,
  PermissionsOf,
} from '../authorization/authorization.service';
import { FileService } from '../file';
import { ProjectChangeRequest } from '../project-change-request/dto';
import { BudgetRecordRepository } from './budget-record.repository';
import { BudgetRepository } from './budget.repository';
import {
  Budget,
  BudgetListInput,
  BudgetListOutput,
  BudgetRecord,
  BudgetRecordListInput,
  BudgetRecordListOutput,
  BudgetStatus,
  CreateBudget,
  CreateBudgetRecord,
  UpdateBudget,
  UpdateBudgetRecord,
} from './dto';

@Injectable()
export class BudgetService {
  constructor(
    private readonly files: FileService,
    @Inject(forwardRef(() => AuthorizationService))
    private readonly authorizationService: AuthorizationService,
    private readonly budgetRepo: BudgetRepository,
    private readonly budgetRecordsRepo: BudgetRecordRepository,
    private readonly resources: ResourceResolver,
    @Logger('budget:service') private readonly logger: ILogger
  ) {}

  async create(
    { projectId, ...input }: CreateBudget,
    session: Session
  ): Promise<Budget> {
    this.logger.debug('Creating budget', { projectId });

    const projectExists = await this.budgetRepo.doesProjectExist(
      projectId,
      session
    );
    if (!projectExists) {
      throw new NotFoundException('project does not exist', 'budget.projectId');
    }

    const universalTemplateFileId = await generateId();

    try {
      const budgetId = await this.budgetRepo.create(
        { projectId, ...input },
        universalTemplateFileId,
        session
      );

      this.logger.debug(`Created Budget`, {
        id: budgetId,
        userId: session.userId,
      });

      await this.files.createDefinedFile(
        universalTemplateFileId,
        `Universal Budget Template`,
        session,
        budgetId,
        'universalTemplateFile',
        input.universalTemplateFile,
        'budget.universalTemplateFile'
      );

      await this.authorizationService.processNewBaseNode(
        Budget,
        budgetId,
        session.userId
      );

      return await this.readOne(budgetId, session);
    } catch (exception) {
      this.logger.error(`Could not create budget`, {
        userId: session.userId,
        exception,
      });
      throw new ServerException('Could not create budget', exception);
    }
  }

  async createRecord(
    input: CreateBudgetRecord,
    session: Session,
    changeset?: ID
  ): Promise<BudgetRecord> {
    const { organizationId, fiscalYear } = input;

    if (!fiscalYear || !organizationId) {
      throw new InputException(
        !fiscalYear ? 'budget.fiscalYear' : 'budget.organizationId'
      );
    }

    await this.verifyRecordUniqueness(input);

    this.logger.debug('Creating BudgetRecord', input);

    try {
      const recordId = await this.budgetRecordsRepo.create(input, changeset);

      await this.authorizationService.processNewBaseNode(
        BudgetRecord,
        recordId,
        session.userId
      );

      this.logger.debug(`Created Budget Record`, {
        id: recordId,
        userId: session.userId,
      });

      const budgetRecord = await this.readOneRecord(
        recordId,
        session,
        viewOfChangeset(changeset)
      );

      return budgetRecord;
    } catch (exception) {
      this.logger.error(`Could not create Budget Record`, {
        userId: session.userId,
        exception,
      });
      throw new ServerException('Could not create Budget Record', exception);
    }
  }

  private async verifyRecordUniqueness(input: CreateBudgetRecord) {
    const exists = await this.budgetRecordsRepo.doesRecordExist(input);
    if (exists) {
      throw new DuplicateException(
        'fiscalYear',
        'A record for given partner and fiscal year already exists in this budget'
      );
    }
  }

  @HandleIdLookup(Budget)
  async readOne(id: ID, session: Session, view?: ObjectView): Promise<Budget> {
    this.logger.debug(`readOne budget`, {
      id,
      userId: session.userId,
    });

    const result = await this.budgetRepo.readOne(id, session, view);

    const perms = await this.authorizationService.getPermissions({
      resource: Budget,
      sessionOrUserId: session,
      dto: result as ResourceShape<Budget>['prototype'],
    });

    const securedProps = parseSecuredProperties(
      result,
      perms as PermissionsOf<Budget>,
      Budget.SecuredProps
    );

    let records = null;
    if (perms.records.canRead) {
      records = await this.listRecords(
        {
          sort: 'fiscalYear',
          order: Order.ASC,
          page: 1,
          count: 25,
          filter: { budgetId: id },
        },
        session,
        view
      );
    }

    const changeRequest = view?.changeset
      ? await this.resources.lookup(
          ProjectChangeRequest,
          view.changeset,
          session
        )
      : undefined;

    return {
      ...result,
      ...securedProps,
      // Show budget status as Pending, to allow budget record changes,
      // if we are in an editable change request.
      status: changeRequest?.canEdit ? BudgetStatus.Pending : result.status,
      records: records?.items || [],
      canDelete: await this.budgetRepo.checkDeletePermission(id, session),
    };
  }

  @HandleIdLookup(BudgetRecord)
  async readOneRecord(
    id: ID,
    session: Session,
    view?: ObjectView
  ): Promise<BudgetRecord> {
    this.logger.debug(`readOne BudgetRecord`, {
      id,
      userId: session.userId,
    });

    const result = await this.budgetRecordsRepo.readOne(id, session, view);

    const securedProps = await this.authorizationService.secureProperties(
      BudgetRecord,
      result,
      session
    );

    return {
      ...result,
      ...securedProps,
      canDelete: await this.budgetRepo.checkDeletePermission(id, session),
    };
  }

  async update(input: UpdateBudget, session: Session): Promise<Budget> {
    const budget = await this.readOne(input.id, session);

    const changes = this.budgetRepo.getActualChanges(budget, input);
    await this.authorizationService.verifyCanEditChanges(
      Budget,
      budget,
      changes
    );
    const { universalTemplateFile, ...simpleChanges } = changes;
    await this.files.updateDefinedFile(
      budget.universalTemplateFile,
      'budget.universalTemplateFile',
      universalTemplateFile,
      session
    );
    return await this.budgetRepo.updateProperties(budget, simpleChanges);
  }

  async updateRecord(
    { id, ...input }: UpdateBudgetRecord,
    session: Session,
    changeset?: ID
  ): Promise<BudgetRecord> {
    this.logger.debug('Update budget record', { id, userId: session.userId });

    await this.verifyCanEdit(id, session);

    const br = await this.readOneRecord(
      id,
      session,
      viewOfChangeset(changeset)
    );
    const changes = this.budgetRecordsRepo.getActualChanges(br, input);
    await this.authorizationService.verifyCanEditChanges(
      BudgetRecord,
      br,
      changes
    );

    try {
      const result = await this.budgetRecordsRepo.updateProperties(
        br,
        changes,
        changeset
      );
      return result;
    } catch (e) {
      this.logger.error('Could not update budget Record ', {
        id,
        userId: session.userId,
      });
      throw e;
    }
  }

  private async verifyCanEdit(recordId: ID, session: Session) {
    if (session.roles.includes('global:Administrator')) {
      return;
    }
    const status = await this.budgetRepo.getStatusByRecord(recordId);
    if (status !== BudgetStatus.Pending) {
      throw new InputException(
        'Budget cannot be modified',
        'budgetRecord.amount'
      );
    }
  }

  async delete(id: ID, session: Session): Promise<void> {
    const budget = await this.readOne(id, session);

    if (!budget) {
      throw new NotFoundException('Could not find Budget');
    }

    const canDelete = await this.budgetRepo.checkDeletePermission(id, session);
    if (!canDelete)
      throw new UnauthorizedException(
        'You do not have the permission to delete this Budget'
      );

    // cascade delete each budget record in this budget
    await Promise.all(
      budget.records.map((br) => this.deleteRecord(br.id, session))
    );

    try {
      await this.budgetRepo.deleteNode(budget);
    } catch (e) {
      this.logger.warning('Failed to delete budget', {
        exception: e,
      });
      throw new ServerException('Failed to delete budget');
    }
  }

  async deleteRecord(id: ID, session: Session, changeset?: ID): Promise<void> {
    const br = await this.readOneRecord(
      id,
      session,
      viewOfChangeset(changeset)
    );

    if (!br) {
      throw new NotFoundException('Could not find Budget Record');
    }

    const canDelete = await this.budgetRecordsRepo.checkDeletePermission(
      id,
      session
    );

    if (!canDelete)
      throw new UnauthorizedException(
        'You do not have the permission to delete this Budget Record'
      );

    try {
      await this.budgetRecordsRepo.deleteNode(br, changeset);
    } catch (e) {
      this.logger.warning('Failed to delete Budget Record', {
        exception: e,
      });
      throw new ServerException('Failed to delete Budget Record');
    }
  }

  async list(
    partialInput: Partial<BudgetListInput>,
    session: Session,
    changeset?: ID
  ): Promise<BudgetListOutput> {
    const input = {
      ...BudgetListInput.defaultVal,
      ...partialInput,
    };
    const limited = (await this.authorizationService.canList(Budget, session))
      ? // --- need a sensitivity mapping for global because ConsultantManager has a global sensitivityAccess of Sensitivity.Medium for listing.
        await this.authorizationService.getListRoleSensitivityMapping(
          Budget,
          'global'
        )
      : await this.authorizationService.getListRoleSensitivityMapping(
          Budget,
          'project'
        );

    const results = await this.budgetRepo.list(input, session, limited);
    return await mapListResults(results, (id) =>
      this.readOne(id, session, viewOfChangeset(changeset))
    );
  }

  async listNoSecGroups(
    partialInput: Partial<BudgetListInput>,
    session: Session,
    changeset?: ID
  ): Promise<BudgetListOutput> {
    const input = {
      ...BudgetListInput.defaultVal,
      ...partialInput,
    };
    const results = await this.budgetRepo.listNoSecGroups(input);
    return await mapListResults(results, (id) =>
      this.readOne(id, session, viewOfChangeset(changeset))
    );
  }

  async listRecords(
    input: BudgetRecordListInput,
    session: Session,
    view?: ObjectView
  ): Promise<BudgetRecordListOutput> {
    const results = await this.budgetRecordsRepo.list(input, session, view);

    return await mapListResults(results, (id) =>
      this.readOneRecord(id, session, view)
    );
  }
}
