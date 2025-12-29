import "reflect-metadata";
import _ from "lodash";
import { GraphQLContext } from "./context";
import { Resolver, Args, Ctx, Mutation, Query, Authorized, Arg, Info } from "type-graphql";
import { comparePassword, createLoginAndToken, expireAccessToken, hashPassword, sendEmailPasswordResetLink, sendEmailVerificationRequest, sendPhoneNumberPasswordResetLink, sendPhoneNumberVerificationRequest, verifyEmailAddress, verifyPhoneNumber } from "./auth";
import { LogInUserArgs, LogInUserResponse, RegisterUserArgs, SafeUser, VerifyEmailAddressArgs, VerifyPhoneNumberArgs, ResendPhoneNumberVerificationRequestArgs, ResendEmailVerificationRequestArgs, ValidateTokenArgs, ValidateTokenResponse, STFindManyProductArgs, STFindManyPurchaseOrderArgs, STFindManyItemArgs, STProductOrderByWithRelationInput, SendPasswordResetLinkArgs, RegisterUserResponse, ResendEmailVerificationResponse, ResendPhoneNumberVerificationResponse } from "./types";
import { GraphQLVoid } from "graphql-scalars";
import crypto from "crypto";
import { extractIpAddress } from "./util";
import { Item, Product, PurchaseOrder, FindManyProductResolver, FindManyProductArgs, FindManyItemArgs, FindManyItemResolver, FindManyPurchaseOrderResolver, FindManyPurchaseOrderArgs, User, Role, AccessToken } from "@generated/type-graphql"
import { GraphQLResolveInfo } from "graphql";

const generateOTP = () => crypto.randomInt(0, 1000000);

const sanitizeUser = (user:User): SafeUser => _.omit(user, "password", "otp", "otpCreatedAt", "phoneNumberVerified", "emailVerified");

@Resolver(of => SafeUser)
export class CustomUserResolver {
    @Mutation(returns => RegisterUserResponse)
    async registerUser(
        @Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { name, phoneNumber, email, password }: RegisterUserArgs,
    ) : Promise<RegisterUserResponse> {
        const otp = generateOTP();
        const user = await prisma.user.create({
            data: {
                name,
                phoneNumber,
                otp,
                otpCreatedAt: new Date(),
                email: email.toLowerCase(),
                password: await hashPassword(password),
                role: Role.NORMAL,
            }
        });
        const result:RegisterUserResponse = { userId: user.id };
        const failures : Array<string> = [];
        try {
            await sendEmailVerificationRequest(user);
        } catch (err) {
            failures.push('email');
            console.error(err);
        }
        try {
            await sendPhoneNumberVerificationRequest(user);
        } catch (err) {
            failures.push('SMS');
            console.error(err);
        }
        if (failures.length) {
            result.error = `Failed to send ${failures.join(' and ')}. Please check back later by trying to log in.`;
        }
        return result;
    }

    @Mutation(returns => GraphQLVoid, { nullable: true })
    async sendPasswordResetLink(@Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { emailOrPhone }: SendPasswordResetLinkArgs,
    ) : Promise<void> {
        const user = await prisma.user.findFirst({
            where: { OR: [
                { email: emailOrPhone.toLowerCase() },
                { phoneNumber: emailOrPhone.toLowerCase() }
            ] }
        });
        if (!user) {
            throw "User not found";
        }
        await sendEmailPasswordResetLink(user);
        await sendPhoneNumberPasswordResetLink(user);
    }

    @Mutation(returns => ResendEmailVerificationResponse)
    async resendEmailVerificationRequest(@Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { email }: ResendEmailVerificationRequestArgs,
    ) : Promise<ResendEmailVerificationResponse> {
        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });
        if (!user) {
            return { error: "User not found." };
        }
        try {
            await sendEmailVerificationRequest(user);
        } catch (err) {
            return { error: "Failed to send email." };
        }
        return {};
    }

    @Mutation(returns => ResendPhoneNumberVerificationResponse)
    async resendPhoneNumberVerificationRequest(@Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { phoneNumber }: ResendPhoneNumberVerificationRequestArgs,
    ) : Promise<ResendPhoneNumberVerificationResponse> {
        const otp = generateOTP();
        let user;
        try {
            user = await prisma.user.update({
                where: { phoneNumber },
                data: {
                    otp,
                    otpCreatedAt: new Date()
                }
            });
        } catch (e) {
            return { error: "User not found." };
        }
        try {
            await sendPhoneNumberVerificationRequest(user);
        } catch(err) {
            return { error: "Failed to send SMS." };
        }
        return {};
    }

    @Mutation(returns => GraphQLVoid, { nullable: true })
    async verifyPhoneNumber(
        @Ctx() { prisma }: GraphQLContext,
        @Args() { userId, otp }: VerifyPhoneNumberArgs,
    ) : Promise<void> {
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });
        if (!user) {
            throw "User not found";
        }
        verifyPhoneNumber(user, otp);
        await prisma.user.updateMany({
            where: {
                id: userId,
                phoneNumberVerified: null
            },
            data: { phoneNumberVerified: new Date() }
        });
    }

    @Mutation(returns => GraphQLVoid, { nullable: true })
    async verifyEmailAddress(
        @Ctx() { prisma }: GraphQLContext,
        @Args() { token }: VerifyEmailAddressArgs,
    ) : Promise<void> {
        const userId = verifyEmailAddress(token);
        await prisma.user.updateMany({
            where: {
                id: userId,
                emailVerified: null
            },
            data: { emailVerified: new Date() }
        });
    }

    @Mutation(returns => LogInUserResponse)
    async logInUser(
        @Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { emailOrPhone, password }: LogInUserArgs,
    ) : Promise<LogInUserResponse> {
        let user = await prisma.user.findFirst({
            where: { OR: [
                { email: emailOrPhone.toLowerCase() },
                { phoneNumber: emailOrPhone.toLowerCase() }
            ] }
        });
        if (!user) {
            return { error: "No user account matches the provided email address or phone number." };
        }
        const passwordsMatch: boolean = await comparePassword(user.password, password);
        if (!passwordsMatch) {
            return { error: "Incorrect password." };
        }
        const response: LogInUserResponse = { user: sanitizeUser(user) }
        if (!user.emailVerified) {
            response.error = "Unverified email address.";
        } else if (!user.phoneNumberVerified) {
            response.error = "Unverified phone number.";
        } else {
            response.token = await createLoginAndToken(prisma, extractIpAddress(initialContext.req), user.id, true);
        }
        return response;
    }

    @Authorized()
    @Mutation(returns => GraphQLVoid, { nullable: true })
    async logOutUser(
        @Ctx() { prisma, token }: GraphQLContext
    ) : Promise<void> {
        await expireAccessToken(prisma, token!);
    }

    @Mutation(returns => ValidateTokenResponse)
    async validateToken(
        @Ctx() { initialContext, prisma }: GraphQLContext,
        @Args() { tokenValue }: ValidateTokenArgs,
    ) : Promise<ValidateTokenResponse> {
        const token:AccessToken|null = await prisma.accessToken.findUnique({ where: { value: tokenValue, expired: false } });
        if (token == null) {
            return { error: "Token not found" };
        }
        const user:User|null = await prisma.user.findUnique({ where: { id: token.userId } });
        if (!user) {
            return { error: "User not found" };
        }
        const newTokenValue = await createLoginAndToken(prisma, extractIpAddress(initialContext.req), user.id, false);
        await expireAccessToken(prisma, tokenValue);
        return { token: newTokenValue, user: user }
    }
}

@Resolver(of => Product)
export class CustomProductResolver {
    @Authorized()
    @Query(returns => [Product])
    async listAllProducts(
        @Ctx() ctx: GraphQLContext,
        @Info() info: GraphQLResolveInfo,
        @Args(() => STFindManyProductArgs) args : STFindManyProductArgs,
    ) : Promise<Product[]> {
        const onwardArgs = new FindManyProductArgs();
        if (args.cursor) {
            onwardArgs.cursor = args.cursor;
        }
        if (args.distinct) {
            onwardArgs.distinct = args.distinct;
        }
        if (args.skip) {
            onwardArgs.skip = args.skip;
        }
        if (args.take) {
            onwardArgs.take = args.take;
        }
        if (args.where) {
            onwardArgs.where = args.where;
        }
        if (args.orderBy) {
            onwardArgs.orderBy = args.orderBy?.map(
                (entry) => Object.fromEntries(new Map<string, any>([[entry.field, entry.direction]]))
            );
        }
        return new FindManyProductResolver().products(ctx, info, onwardArgs);
    }
}

@Resolver(of => Item)
export class CustomItemResolver {
    @Authorized()
    @Query(returns => [Item])
    async listAllItems(
        @Ctx() ctx: GraphQLContext,
        @Info() info: GraphQLResolveInfo,
        @Args(() => STFindManyItemArgs) args : STFindManyItemArgs,
    ) : Promise<Item[]> {
        const onwardArgs = new FindManyItemArgs();
        if (args.cursor) {
            onwardArgs.cursor = args.cursor;
        }
        if (args.distinct) {
            onwardArgs.distinct = args.distinct;
        }
        if (args.skip) {
            onwardArgs.skip = args.skip;
        }
        if (args.take) {
            onwardArgs.take = args.take;
        }
        if (args.where) {
            onwardArgs.where = args.where;
        }
        if (args.orderBy) {
            onwardArgs.orderBy = args.orderBy?.map(
                (entry) => Object.fromEntries(new Map<string, any>([[entry.field, entry.direction]]))
            );
        }
        if (ctx.user?.role !== Role.ADMIN) {
            onwardArgs.where = {
                ...onwardArgs.where,
                userId: { equals: ctx.user!.id }
            };
        }
        return new FindManyItemResolver().items(ctx, info, onwardArgs);
    }
}

@Resolver(of => PurchaseOrder)
export class CustomPurchaseOrderResolver {
    @Authorized()
    @Query(returns => [PurchaseOrder])
    async listAllPurchaseOrders(
        @Ctx() ctx: GraphQLContext,
        @Info() info: GraphQLResolveInfo,
        @Args(() => STFindManyPurchaseOrderArgs) args : STFindManyPurchaseOrderArgs,
    ) : Promise<PurchaseOrder[]> {
        const onwardArgs = new FindManyPurchaseOrderArgs();
        if (args.cursor) {
            onwardArgs.cursor = args.cursor;
        }
        if (args.distinct) {
            onwardArgs.distinct = args.distinct;
        }
        if (args.skip) {
            onwardArgs.skip = args.skip;
        }
        if (args.take) {
            onwardArgs.take = args.take;
        }
        if (args.where) {
            onwardArgs.where = args.where;
        }
        if (args.orderBy) {
            onwardArgs.orderBy = args.orderBy?.map(
                (entry) => Object.fromEntries(new Map<string, any>([[entry.field, entry.direction]]))
            );
        }
        if (ctx.user?.role !== Role.ADMIN) {
            onwardArgs.where = {
                ...onwardArgs.where,
                userId: { equals: ctx.user!.id }
            };
        }
        return new FindManyPurchaseOrderResolver().purchaseOrders(ctx, info, onwardArgs);
    }
}
