import { User } from "@generated/type-graphql";
import { IsEmail } from "class-validator";
import { Field, ArgsType, ObjectType } from "type-graphql";

const Omit = <T, K extends keyof T>(Class: new () => T, keys: K[]): new () => Omit<T, typeof keys[number]> => Class;

@ArgsType()
export class RegisterUserArgs {
    @Field()
    name!: string;

    @Field()
    @IsEmail({
        allow_display_name: true
    })
    email!: string;

    @Field()
    password!: string;
}

@ArgsType()
export class LogInUserArgs {
    @Field()
    email!: string;

    @Field()
    password!: string;
}

@ArgsType()
export class VerifyEmailAddressArgs {
    @Field()
    token!: string;
}

@ObjectType()
export class SafeUser extends Omit(User, ['password']) { }

@ObjectType()
export class LogInPayload {
    @Field()
    token!: string;

    @Field()
    user!: SafeUser;
}