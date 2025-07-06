import { ItemScalarFieldEnum, ItemWhereInput, ItemWhereUniqueInput, ProductScalarFieldEnum, ProductWhereInput, ProductWhereUniqueInput, PurchaseOrderScalarFieldEnum, PurchaseOrderWhereInput, PurchaseOrderWhereUniqueInput, SortOrder, User } from "@generated/type-graphql";
import { IsEmail, IsPhoneNumber, IsNumberString, Length } from "class-validator";
import { Field, ArgsType, ObjectType, InputType, Int } from "type-graphql";

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
    emailOrPhone!: string;

    @Field()
    password!: string;
}

@ArgsType()
export class ValidateTokenArgs {
    @Field()
    tokenValue!: string;
}

@ArgsType()
export class ResendEmailVerificationRequestArgs {
    @Field()
    @IsEmail({
        allow_display_name: true
    })
    email!: string;
}

@ArgsType()
export class SendPasswordResetLinkArgs {
    @Field()
    emailOrPhone!: string;
}

@ArgsType()
export class ResendPhoneNumberVerificationRequestArgs {
    @Field()
    @IsPhoneNumber()
    phoneNumber!: string;
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
    error?: string;
    
    @Field()
    token?: string;

    @Field()
    user?: SafeUser;
}

@ObjectType()
export class ValidateTokenPayload {
    @Field()
    token!: string;

    @Field()
    user!: SafeUser;
}

@InputType()
export class STProductOrderByWithRelationInput {
    @Field(type => ProductScalarFieldEnum)
    field!: "id" | "name" | "upc" | "upcScanned" | "description" | "amazonASIN" | "country" | "brand" | "model" | "color" | "weightInKgs" | "widthInCms" | "heightInCms" | "depthInCms" | "currency" | "price" | "createdAt" | "updatedAt";

    @Field(type => SortOrder, { nullable: true })
    direction: "asc" | "desc" | undefined;
}

@InputType()
export class STItemOrderByWithRelationInput {
    @Field(type => ItemScalarFieldEnum)
    field!: "id" | "userId" | "code" | "name" | "description" | "productId" | "weightInKgs" | "widthInCms" | "heightInCms" | "depthInCms" | "createdAt" | "updatedAt";

    @Field(type => SortOrder, { nullable: true })
    direction?: "asc" | "desc" | undefined;
}

@InputType()
export class STPurchaseOrderOrderByWithRelationInput {
    @Field(type => PurchaseOrderScalarFieldEnum)
    field!: "id" | "userId" | "price" | "status" | "createdAt" | "updatedAt";

    @Field(type => SortOrder, { nullable: true })
    direction?: "asc" | "desc" | undefined;
}

@ArgsType()
export class STFindManyProductArgs {
    @Field(type => ProductWhereInput, { nullable: true })
    where?: ProductWhereInput | undefined;
    
    @Field(type => [STProductOrderByWithRelationInput], { nullable: true })
    orderBy?: STProductOrderByWithRelationInput[] | undefined;
    
    @Field(type => ProductWhereUniqueInput, { nullable: true })
    cursor?: ProductWhereUniqueInput | undefined;
    
    @Field(type => Int, { nullable: true })
    take?: number | undefined;
    
    @Field(type => Int, { nullable: true })
    skip?: number | undefined;
    
    @Field(type => ProductScalarFieldEnum,  { nullable: true })
    distinct?: Array<"id" | "name" | "upc" | "upcScanned" | "description" | "amazonASIN" | "country" | "brand" | "model" | "color" | "weightInKgs" | "widthInCms" | "heightInCms" | "depthInCms" | "currency" | "price" | "createdAt" | "updatedAt"> | undefined;
}

@ArgsType()
export class STFindManyItemArgs {
    @Field(type => ItemWhereInput, { nullable: true })
    where?: ItemWhereInput | undefined;
    
    @Field(type => [STItemOrderByWithRelationInput], { nullable: true })
    orderBy?: STItemOrderByWithRelationInput[] | undefined;
    
    @Field(type => ItemWhereUniqueInput, { nullable: true })
    cursor?: ItemWhereUniqueInput | undefined;
    
    @Field(type => Int, { nullable: true })
    take?: number | undefined;
    
    @Field(type => Int, { nullable: true })
    skip?: number | undefined;
    
    @Field(type => ItemScalarFieldEnum,  { nullable: true })
    distinct?: Array<"id" | "userId" | "code" | "name" | "description" | "productId" | "weightInKgs" | "widthInCms" | "heightInCms" | "depthInCms" | "createdAt" | "updatedAt"> | undefined;
}

@ArgsType()
export class STFindManyPurchaseOrderArgs {
    @Field(type => PurchaseOrderWhereInput, { nullable: true })
    where?: PurchaseOrderWhereInput | undefined;

    @Field(type => [STPurchaseOrderOrderByWithRelationInput], { nullable: true })
    orderBy?: STPurchaseOrderOrderByWithRelationInput[] | undefined;
    
    @Field(type => PurchaseOrderWhereUniqueInput, { nullable: true })
    cursor?: PurchaseOrderWhereUniqueInput | undefined;

    @Field(type => Int, { nullable: true })
    take?: number | undefined;

    @Field(type => Int, { nullable: true })
    skip?: number | undefined;

    @Field(type => PurchaseOrderScalarFieldEnum,  { nullable: true })
    distinct?: Array<"id" | "userId" | "price" | "status" | "createdAt" | "updatedAt"> | undefined;
}
