import {
  Args,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { IdArg, ISession, Session } from '../../common';
import {
  CreateDirectoryInput,
  Directory,
  FileListInput,
  FileListOutput,
  FileNodeType,
} from './dto';
import { FileNodeResolver } from './file-node.resolver';

@Resolver(Directory.classType)
export class DirectoryResolver extends FileNodeResolver(
  FileNodeType.Directory,
  Directory.classType
) {
  @Query(() => Directory)
  async directory(
    @IdArg() id: string,
    @Session() session: ISession
  ): Promise<Directory> {
    return this.service.getDirectory(id, session);
  }

  @ResolveField(() => FileListOutput, {
    description: 'Return the file nodes of this directory',
  })
  async children(
    @Session() session: ISession,
    @Parent() node: Directory,
    @Args({
      name: 'input',
      type: () => FileListInput,
      defaultValue: FileListInput.defaultVal,
    })
    input: FileListInput
  ): Promise<FileListOutput> {
    return this.service.listChildren(input, session);
  }

  @Mutation(() => Directory)
  async createDirectory(
    @Session() session: ISession,
    @Args('input') { parentId, name }: CreateDirectoryInput
  ): Promise<Directory> {
    return this.service.createDirectory(parentId, name, session);
  }
}
