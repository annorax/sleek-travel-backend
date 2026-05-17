import '../src/schema';
import { builder } from '../src/builder';
import { printSchema } from 'graphql';

process.stdout.write(printSchema(builder.toSchema()) + '\n');
