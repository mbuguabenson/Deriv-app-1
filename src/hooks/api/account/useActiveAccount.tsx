import { useMemo } from 'react';
import { isVirtualAccount } from '@/utils/account-helpers';
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getDecimalPlaces } from '@/components/shared';
import { useApiBase } from '@/hooks/useApiBase';
import { Balance } from '@deriv/api-types';

/** A custom hook that returns the account object for the current active account. */
const useActiveAccount = ({
    allBalanceData,
    directBalance,
}: {
    allBalanceData: Balance | null;
    directBalance?: string;
}) => {
    const { accountList, activeLoginid, authData } = useApiBase();

    const resolvedLoginId =
        activeLoginid ||
        authData?.loginid ||
        localStorage.getItem('active_loginid') ||
        localStorage.getItem('client.loginid') ||
        '';

    const activeAccount = useMemo(() => {
        if (!resolvedLoginId) return undefined;

        const found = accountList?.find(account => account.loginid === resolvedLoginId);
        if (found) return found;

        return {
            loginid: resolvedLoginId,
            currency: authData?.currency || 'USD',
            balance: authData?.balance ?? 0,
            is_virtual: isVirtualAccount(resolvedLoginId) ? 1 : 0,
        };
    }, [resolvedLoginId, accountList, authData]);

    const currentBalanceData = allBalanceData?.accounts?.[activeAccount?.loginid ?? ''];

    const modifiedAccount = useMemo(() => {
        if (!activeAccount) return undefined;

        const isVirtual = isVirtualAccount(activeAccount.loginid);
        const accCurrency = activeAccount?.currency || 'USD';

        let rawBal: number | string = 0;
        if (directBalance !== undefined && directBalance !== null && directBalance !== '') {
            rawBal = directBalance;
        } else if (currentBalanceData?.balance !== undefined) {
            rawBal = currentBalanceData.balance;
        } else if (activeAccount.balance !== undefined && activeAccount.balance !== null) {
            rawBal = activeAccount.balance;
        } else if (authData?.loginid === activeAccount.loginid && authData?.balance !== undefined) {
            rawBal = authData.balance;
        }

        const numBal = typeof rawBal === 'number' ? rawBal : parseFloat(String(rawBal).replace(/,/g, '')) || 0;

        return {
            ...activeAccount,
            balance: addComma(numBal.toFixed(getDecimalPlaces(currentBalanceData?.currency || accCurrency))),
            currencyLabel: isVirtual ? 'Demo' : accCurrency,
            icon: <CurrencyIcon currency={accCurrency.toLowerCase() || 'usd'} isVirtual={false} />,
            isVirtual: isVirtual,
            isActive: true,
        };
    }, [activeAccount, currentBalanceData, directBalance, authData]);

    return {
        /** User's current active account. */
        data: modifiedAccount,
    };
};

export default useActiveAccount;
