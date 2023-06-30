import { User } from "@generated/type-graphql";
import { IsEmail, IsPhoneNumber, IsNumberString, Length } from "class-validator";
import { Field, ArgsType, ObjectType } from "type-graphql";

const Omit = <T, K extends keyof T>(Class: new () => T, keys: K[]): new () => Omit<T, typeof keys[number]> => Class;

@ArgsType()
export class RegisterUserArgs {
    @Field()
    name!: string;

    @Field()
    @IsPhoneNumber()
    phoneNumber!: string;

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

@ArgsType()
export class VerifyPhoneNumberArgs {
    @Field()
    userId!: number;

    @Field()
    @IsNumberString({
        no_symbols: true
    })
    @Length(6)
    otp!: string;
}

@ObjectType()
export class SafeUser extends Omit(User, ["password", "otp", "otpCreatedAt", "phoneNumberVerified", "emailVerified", "createdAt", "updatedAt"]) { }

@ObjectType()
export class LogInPayload {
    @Field()
    token!: string;

    @Field()
    user!: SafeUser;
}