-- "Didn't run today" on a T-Force driver code (client request, Nov 25 2026): the code stays on the list,
-- nobody is paid that day and T-Force reporting nothing for it is not an exception.
ALTER TYPE "core"."execution_status" ADD VALUE 'off';
